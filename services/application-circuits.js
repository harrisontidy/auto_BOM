// Reviewed topology: Microchip DS20001826F, Table 3-1 and Figure 6-1.
export function typicalApplication(candidate) {
  const mpn = String(candidate.manufacturerPartNumber || '').toUpperCase();
  if (!/^MCP1700T?-(120|180|250|280|300|330|500)2[ET]\/TT$/.test(mpn)
      || !/microchip/i.test(candidate.manufacturer || '')) return null;
  const source = 'https://ww1.microchip.com/downloads/en/DeviceDoc/MCP1700-Data-Sheet-20001826F.pdf';
  const pin = (ref, number) => ({ref, pin:number});
  const point = (x,y) => ({x,y});
  return {
    id:'mcp1700-sot23', title:'MCP1700 regulator with input and output capacitors',
    source, sourceSection:'Table 3-1, Figure 6-1 and Sections 5.1–5.2',
    description:'Adds two 1 µF ceramic capacitors and wired input, output and ground connections. Passive part numbers are left blank for AutoBOM.',
    notes:'Check input voltage, dropout, load and dissipation for the selected output variant. Output capacitance must remain at least 1 µF under bias; ESR 0–2 Ω. Place capacitors close to the regulator.',
    parts:[
      {ref:'u',symbolId:'Regulator_Linear:MCP1700x-300xxTT',value:mpn,footprintId:'Package_TO_SOT_SMD:SOT-23',x:0,y:0,primary:true},
      {ref:'cin',symbolId:'Device:C',value:'1uF',footprintId:'Capacitor_SMD:C_0805_2012Metric',x:-1000,y:400,fields:{'Sourcing Requirements':'16V minimum; ceramic X7R','Application Role':'Input bypass'}},
      {ref:'cout',symbolId:'Device:C',value:'1uF',footprintId:'Capacitor_SMD:C_0805_2012Metric',x:1000,y:400,fields:{'Sourcing Requirements':'16V minimum; ceramic X7R','Application Role':'Output stability capacitor'}}
    ],
    wires:[{a:pin('cin','1'),b:pin('u','3')},{a:pin('cout','1'),b:pin('u','2')},
      {a:pin('u','1'),b:point(0,800)},{a:pin('cin','2'),b:point(-1000,800)},
      {a:pin('cout','2'),b:point(1000,800)},{a:point(-1000,800),b:point(0,800)},
      {a:point(0,800),b:point(1000,800)}],
    junctions:[point(0,800)],
    labels:[{at:pin('u','3'),name:'VIN'},{at:pin('u','2'),name:'VOUT'},{at:point(0,800),name:'GND'}]
  };
}
