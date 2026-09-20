// Small arithmetic language, deliberately not JavaScript or eval. Values use SI units.
export function calculate(expression,variables={}) {
  if(typeof expression!=='string'||expression.length>600)throw Error('Invalid calculation expression.');
  const tokens=expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[()+*/^%-]/gi)||[];
  if(tokens.join('')!==expression.replace(/\s/g,'')||tokens.length>200)throw Error('Unsupported calculation syntax.');
  let i=0;
  const atom=()=>{
    const token=tokens[i++];
    if(token==='('){const value=sum();if(tokens[i++]!==')')throw Error('Unbalanced calculation.');return value;}
    if(/^(?:\d|\.)/.test(token||''))return Number(token);
    if(Object.hasOwn(variables,token)&&Number.isFinite(variables[token]))return variables[token];
    throw Error(`Unknown calculation variable ${token}.`);
  };
  const power=()=>{const value=atom();return tokens[i]==='^'?(i++,value**unary()):value;};
  const unary=()=>tokens[i]==='-'?(i++,-unary()):tokens[i]==='+'?(i++,unary()):power();
  const product=()=>{let value=unary();while(['*','/','%'].includes(tokens[i])){const op=tokens[i++],rhs=unary();value=op==='*'?value*rhs:op==='/'?value/rhs:value%rhs;}return value;};
  const sum=()=>{let value=product();while(['+','-'].includes(tokens[i])){const op=tokens[i++],rhs=product();value=op==='+'?value+rhs:value-rhs;}return value;};
  const result=sum();if(i!==tokens.length||!Number.isFinite(result))throw Error('Calculation is incomplete or non-finite.');return result;
}

export function verifyCalculations(calculations,parts,pageCount) {
  if(!Array.isArray(calculations)||calculations.length>40)throw Error('Too many design calculations.');
  return calculations.map(c=>{
    if(!Number.isInteger(c.page)||c.page<1||c.page>pageCount||!c.evidence||c.evidence.length<8)throw Error('Calculation needs a datasheet equation citation.');
    if(!Array.isArray(c.variables)||c.variables.length>30)throw Error('Invalid calculation inputs.');
    const vars=Object.create(null);
    for(const v of c.variables){
      if(!/^[a-z][a-z0-9_]*$/i.test(v.name)||Object.hasOwn(vars,v.name)||!Number.isFinite(v.value)||!v.source?.trim())throw Error('Invalid calculation variable or source.');
      vars[v.name]=v.value;
    }
    const result=calculate(c.expression,vars);
    // Accept presentation rounding to three significant digits; retain the exact computed result.
    if(!Number.isFinite(c.result)||Math.abs(result-c.result)>Math.max(1e-12,Math.abs(result)*0.001))throw Error(`Arithmetic mismatch for ${c.name}: computed ${result} ${c.unit}, reported ${c.result}.`);
    for(const ref of c.partRefs||[])if(ref!=='u'&&!parts.some(p=>p.ref===ref))throw Error(`Calculation references missing part ${ref}.`);
    return {...c,result};
  });
}
