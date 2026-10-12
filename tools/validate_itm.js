// Fuzz-compare src/itm.js against the NTIA/ITS C++ reference (build it first with tools/build_itm_ref.sh).
// Usage: node tools/validate_itm.js
const path=require('path');const ITM=require(path.join(__dirname,'..','src','itm.js'));const {execSync}=require('child_process');
let seed=7;function rnd(){seed=(seed*16807)%2147483647;return seed/2147483647;}
let cases=[],input='';
for(let k=0;k<3000;k++){
  const np=10+Math.floor(rnd()*600), xi=20+rnd()*400;
  const base=rnd()*2000, rough=rnd()*rnd()*600; let z=[];let ph=rnd()*6;
  for(let i=0;i<=np;i++){z.push(Math.max(0,base+rough*Math.sin(i/ (3+rnd()*30)+ph)+rough*0.3*(rnd()-0.5)+ (rnd()<0.02?rnd()*rough*2:0)));}
  const o={htx:1+rnd()*rnd()*300,hrx:1+rnd()*rnd()*300,climate:1+Math.floor(rnd()*7),N0:250+rnd()*120,f:20+rnd()*rnd()*15000,pol:rnd()<.5?0:1,eps:[15,25,80,4,10][Math.floor(rnd()*5)],sigma:[0.005,0.02,5,0.001,0.01][Math.floor(rnd()*5)],mdvar:[0,1,2,3,12,23][Math.floor(rnd()*6)],time:1+rnd()*98,loc:1+rnd()*98,sit:1+rnd()*98};
  cases.push({z,np,xi,o});
  input+=[o.htx,o.hrx,o.climate,o.N0,o.f,o.pol,o.eps,o.sigma,o.mdvar,o.time,o.loc,o.sit,np,xi].join(' ')+' '+z.join(' ')+'\n';
}
const out=execSync(path.join(__dirname,'itm-ref','itmref'),{input,maxBuffer:1e8}).toString().trim().split('\n');
let maxd=0,bad=0,errs=0;
cases.forEach((c,i)=>{const [r,A,m]=out[i].split(' ').map(Number);const pfl=[c.np,c.xi,...c.z];const j=ITM.p2p(pfl,c.o);
 if(r>=1000){ if(j.err!==r){bad++; if(bad<5)console.log('err mismatch',r,j.err);} errs++; return;}
 const d=Math.abs(j.A-A); if(!(d<1e-6)||j.mode!==m){bad++; if(bad<8)console.log('mismatch',i,A,j.A,m,j.mode);} if(d>maxd)maxd=d;});
console.log('cases',cases.length,'errs',errs,'bad',bad,'maxdiff',maxd);
process.exitCode = bad ? 1 : 0;
