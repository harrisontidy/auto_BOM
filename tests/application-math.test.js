import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate,verifyCalculations} from '../services/application-math.js';
test('evaluates feedback, filter and timing equations with SI values',()=>{
 assert.equal(calculate('Vref*(1+Rtop/Rbottom)',{Vref:1.221,Rtop:31600,Rbottom:10000}),5.07936);
 assert.equal(calculate('(Vin-Vout)*Vout/(Vin*f*di)',{Vin:12,Vout:5.1,f:500000,di:0.9}),6.516666666666666e-6);
 assert.equal(calculate('2^3^2'),512);assert.equal(calculate('-2^2'),-4);
});
test('never executes code or accepts missing/nonfinite inputs',()=>{
 for(const expression of ['process.exit()','a.constructor','1/0','1e999','missing+1','1 2','2*(3'])assert.throws(()=>calculate(expression));
});
const calculation={name:'Output voltage',expression:'Vref*(1+Rtop/Rbottom)',variables:[{name:'Vref',value:1.221,source:'Datasheet page 16'},{name:'Rtop',value:31600,source:'Selected R1'},{name:'Rbottom',value:10000,source:'Selected R2'}],result:5.07936,unit:'V',partRefs:['r1','r2'],page:16,evidence:'Output voltage divider equation'};
test('verifies arithmetic and rejects incorrect results, absent parts and sources',()=>{
 const parts=[{ref:'r1'},{ref:'r2'}];
 assert.equal(verifyCalculations([calculation],parts,30)[0].result,5.07936);
 assert.equal(verifyCalculations([{...calculation,result:5.08,partRefs:['u']}],parts,30)[0].result,5.07936);
 assert.throws(()=>verifyCalculations([{...calculation,result:5.1}],parts,30),/Arithmetic mismatch/);
 assert.throws(()=>verifyCalculations([calculation],[],30),/missing part/);
 assert.throws(()=>verifyCalculations([calculation],parts,2),/citation/);
});
