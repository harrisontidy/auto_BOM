// Reviewed topology: Microchip DS20001826F, Table 3-1 and Figure 6-1.
export function typicalApplication(candidate) {
  const mpn = String(candidate.manufacturerPartNumber || '').toUpperCase();
  if (mpn === 'XL1509-5.0E1' && /xlsemi/i.test(candidate.manufacturer || '')) return xl1509Circuit(mpn);
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


// XLSEMI XL1509 Rev 2.6, Table 1 and Figure 4, explicitly 12 V -> 5 V / 2 A.
function xl1509Circuit(mpn) {
  const pin=(ref,number)=>({ref,pin:number}), point=(x,y)=>({x,y});
  const wires=[], wire=(a,b)=>wires.push({a,b});
  wire(pin('u','1'),point(-900,-100));wire(point(-900,-100),point(-1400,-100));
  wire(pin('cin','1'),point(-1400,-100));wire(pin('bypass','1'),point(-900,-100));
  wire(pin('u','2'),point(650,-100));wire(point(650,-100),pin('l','1'));
  wire(pin('d','1'),point(650,-100));
  wire(pin('l','2'),point(1450,-100));wire(point(1450,-100),point(1650,-100));
  wire(pin('cout','1'),point(1650,-100));
  wire(pin('u','3'),point(1450,100));wire(point(1450,100),point(1450,-100));
  wire(pin('u','4'),point(-600,100));wire(point(-600,100),point(-600,900));
  for(const [ref,p,x] of [['cin','2',-1400],['bypass','2',-900],['u','5',0],['d','2',650],['cout','2',1650]])wire(pin(ref,p),point(x,900));
  const ground=[-1400,-900,-600,0,650,1650];
  for(let i=1;i<ground.length;i++)wire(point(ground[i-1],900),point(ground[i],900));
  const passive=(ref,symbolId,value,x,y,requirements,extra={})=>({ref,symbolId,value,x,y,footprintId:'',fields:{'Sourcing Requirements':requirements},...extra});
  return {
    id:'xl1509-5v-so8',title:'XL1509: 12 V to 5 V, 2 A reference circuit',
    source:'https://www.xlsemi.com/datasheet/XL1509-EN.pdf',sourceSection:'Rev 2.6, Table 1 and Figure 4 (page 3)',
    description:'12 V to 5 V / 2 A. Includes a 68 uH inductor, 1N5820 Schottky diode, 470 uF input capacitor, 1 uF bypass and 180 uF output capacitor. Enable is tied low (always on).',
    notes:'Datasheet reference circuit, not a finished PCB layout. Keep the switching loop short; check capacitor ripple/ESR, inductor saturation and thermal performance. Unsourced support components have blank footprints where package selection is still needed.',
    parts:[{ref:'u',symbolId:'Regulator_Switching:XL1509-5.0',value:mpn,footprintId:'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm',x:0,y:0,primary:true},
      passive('cin','Device:C_Polarized','470uF',-1400,300,'35V minimum; aluminum electrolytic; low ESR; check input ripple current'),
      passive('bypass','Device:C','1uF',-900,300,'35V minimum; ceramic X7R',{footprintId:'Capacitor_SMD:C_0805_2012Metric'}),
      passive('l','Device:L','68uH',1050,-100,'2A minimum DC current rating; saturation current must exceed peak switch current',{rotation:90}),
      passive('d','Device:D_Schottky','1N5820',650,300,'Schottky rectifier; 3A; 20V minimum reverse voltage',{rotation:270,footprintId:'Diode_THT:D_DO-201AD_P15.24mm_Horizontal'}),
      passive('cout','Device:C_Polarized','180uF',1650,300,'35V minimum; aluminum electrolytic; low ESR; check output ripple current')],
    wires,
    junctions:[point(-900,-100),point(650,-100),point(1450,-100),...ground.slice(1,-1).map(x=>point(x,900))],
    labels:[{at:point(-1400,-100),name:'VIN_12V'},{at:point(1650,-100),name:'VOUT_5V'},{at:point(0,900),name:'GND'}]
  };
}
