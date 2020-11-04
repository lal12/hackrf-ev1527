const { listDevices, open, UsbBoardId } = require('hackrf.js');
const LowpassFilter = require('lowpassf');

const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
});

async function main(){
    const device = await open();

    const sampleRate = 10e6;
    await device.setSampleRate(sampleRate)  // 20 Msps
    await device.setFrequency(315e6) // tune to 315 MHz
    await device.setAmpEnable(false)  // RF amplifier = off

    async function capture(){
        // for RX only
        await device.setLnaGain(8)        // IF gain = 8dB
        await device.setVgaGain(12)       // BB gain = 12dB
    
        let count = 0;
        let lastLevelHigh = false;
        let levels = [];

        const highlevel = 3500;
        const minPause = 2;

        device.receive((x)=>{
            for(let i=0;i<x.length/2;i++){
                const a = x[i*2];
                const b = x[i*2+1];
                const val = a*a + b*b;

                //if(val > highlevel)
                    //console.log(val)

                const lvlhigh = val > highlevel;
                if(lastLevelHigh == lvlhigh){
                    count++;
                    if(count*1000/sampleRate > minPause){
                        levels = [];
                        if(count > Number.MAX_SAFE_INTEGER/2)
                            count = (minPause+0.1)*sampleRate/1000;
                    }
                }else{
                    levels.push([lastLevelHigh, count*1000/sampleRate]);
                    //console.log(levels.length, lastLevelHigh ? 'HIGH' : 'LOW', count*1000/sampleRate+'ms');
                    process();
                    count = 1;
                    lastLevelHigh = lvlhigh;
                }
            }
        })

        function process(){
            const BITCNT = 24;
            const PULSECNT = BITCNT*2+1;

            if(levels.length < PULSECNT)
                return;
            if(levels[0][0] == true) //ensure first level to be LOW
                levels.shift();
            
            
            while(levels.length > 1){ // look for packet begin
                if(levels[0][1] > minPause)
                    break;
                levels.shift();
                levels.shift();
            }
            
            if(levels.length < PULSECNT)
                return;

            let bitstr = '';
            for(let i=0;i<BITCNT;i++){
                levels.shift(); // remove LOW before
                const durH = levels.shift()[1];
                if(durH > 0.25 && durH < 0.43){
                    bitstr += 1;
                }else if(durH > 0.9 && durH < 1.15){
                    bitstr += 0;
                }else{ 
                    // inconclusive
                    console.log('inconclusive', durH);
                    return;
                }
            }
            console.log(parseInt(bitstr.substr(0, 20), 2).toString(16), parseInt(bitstr.substr(20), 2).toString(16));
        }   
    }
    
    async function transmit(){
        const devId = 0xecf25;
        const ivalCount = Math.round(sampleRate/1000*0.32);

        // for TX only
        await device.setTxVgaGain(8)      // IF gain = 8dB
        let bufs = [];

        device.transmit(out=>{
            let offs = 0;
            while(out.length > offs && bufs.length > 0){
                let avLen = out.length - offs;
                if(avLen >= bufs[0].length){
                    out.set(bufs[0], offs);
                    offs += bufs[0].length;
                    bufs.shift();
                }else{
                    out.set(bufs[0].subarray(0, avLen), offs);
                    bufs[0] = bufs[0].subarray(avLen);
                }
                
            }
        });

        function writeIvalHIGH(arr, offs, count){
            arr.fill(127, offs*2, 2*(offs+ivalCount)*count);
            return offs+ivalCount*count;
        }
        function writeIvalLOW(arr, offs, count){
            return offs+ivalCount*count;
        }


        rl.on('line', ln=>{
            if(ln.match(/^[A-Fa-f]$/)){
                const val = parseInt(ln, 16);
                const bits = (devId.toString(2).padStart(20, '0')+val.toString(2).padStart(4, '0')).split('');
                const transmitting = bufs.length > 0;
                const arr = new Int8Array((24+31)*ivalCount*2); // interval times * samples per ival * two bytes
                let offs = 0;
                offs = writeIvalHIGH(arr, offs, 1);
                offs = writeIvalLOW(arr, offs, 13);
                for(let bit of bits){
                    if(bit == '1'){
                        offs = writeIvalHIGH(arr, offs, 1);
                        offs = writeIvalLOW(arr, offs, 3);
                    }else{
                        offs = writeIvalHIGH(arr, offs, 3);
                        offs = writeIvalLOW(arr, offs, 1);
                    }
                }
                if(offs != arr.length){
                    console.log('mismatch', offs, arr.length)
                }
                bufs.push(arr);
            }
        })
    }

    transmit();
    //capture();
}

main();
