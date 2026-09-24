const groups={
 resistors:['10k ohm 0603 1% resistor','100 ohm 0805 resistor','1 megaohm 0603 resistor','0.1 ohm 1 watt current sense resistor','10k through-hole trimmer potentiometer'],
 capacitors:['100nF 0603 50V X7R capacitor','10uF 0805 16V ceramic capacitor','470uF 25V through-hole electrolytic capacitor','22pF 0603 C0G capacitor','1uF 0603 10V ceramic capacitor'],
 magnetics:['10uH shielded power inductor rated at least 2A','4.7uH SMD power inductor rated at least 1A','600 ohm at 100MHz 0603 ferrite bead','100uH through-hole inductor','common mode choke for USB 2.0 data lines'],
 diodes:['1N4148W','SS14 Schottky diode','BAT54S','BAV99','1N4007'],
 transistors:['2N7002','AO3400A','MMBT3904','MMBT3906','IRLZ44NPBF'],
 linear_regulators:['MCP1700T-3302E/TT','AMS1117-3.3','LM317T','AP2112K-3.3TRG1','L7805CV'],
 switching_regulators:['TPS5430DDAR','TPS62160DSGR','MP1584EN','LM2596S-ADJ','XL1509-5.0E1'],
 opamps:['OPA1655DBV','LM358DR','MCP6002-I/SN','TL072CP','LMV321IDBVR'],
 logic_timers:['NE555P','SN74HC595DR','SN74HC14DR','SN74LVC1G125DBVR','CD4017BE'],
 interfaces:['MAX3485ESA+','SN65HVD230DR','CH340C','CP2102N-A02-GQFN28','MCP2515-I/SO'],
 microcontrollers:['STM32F103C8T6','STM32G030F6P6','ATMEGA328P-AU','RP2040','ESP32-C3-MINI-1'],
 sensors:['TMP102AIDRLR','BME280','ADXL345BCCZ','INA219AIDCNR','A3144EUA'],
 memory:['W25Q32JVSSIQ','24LC256-I/SN','AT24C02C-SSHM-T','W25Q128JVSIQ','MB85RC256VPNF-G-JNERE1'],
 displays_leds:['full-color RGB OLED display module with SPI interface','128x64 monochrome OLED display module','0603 red LED','WS2812B addressable RGB LED','single digit red seven segment display'],
 connectors:['USB type C USB 2.0 receptacle connector','2.54mm 1x6 through-hole male pin header','JST PH 2 pin 2mm board connector','2 pin 5.08mm PCB screw terminal','microSD card socket'],
 switches:['6x6mm through-hole tactile pushbutton','SMD momentary tactile switch','SPDT slide switch through-hole','rotary encoder with pushbutton','4 position DIP switch through-hole'],
 relays:['5V coil SPDT PCB relay','12V coil SPDT PCB relay','3V coil signal relay','G5V-1-DC5','G6K-2F-Y-DC5'],
 clocks:['16MHz 3225 SMD crystal','32.768kHz 12.5pF tuning fork crystal','8MHz HC49 through-hole crystal','25MHz 3.3V CMOS oscillator','24MHz 3225 SMD crystal'],
 protection:['USBLC6-2SC6','SMBJ24CA TVS diode','500mA resettable PTC fuse SMD','1206 1A fuse','5.1V SOD123 Zener diode'],
 power_support:['TP4056','MCP73831T-2ACI/OT','DRV8833PWPR','ULN2003ADR','IR2104STRPBF']
};
export const searchCases=Object.entries(groups).flatMap(([category,queries],g)=>queries.map((q,i)=>({
 id:g*5+i+1,category,supplier:(g*5+i)%2?'digikey':'lcsc',query:'Find '+q+'.',term:q,
 exact:!q.includes(' ')&&!/ohm|nF|uF/.test(q)
})));
export const circuitCases=[
 {searchId:31,kind:'buck regulator',request:'Generate a 12 V input to 5.1 V output buck regulator circuit, up to 2 A.'},
 {searchId:41,kind:'timer',request:'Generate a 5 V astable timer circuit with approximately 1 Hz output. No LED or output load needed.'},
 {searchId:36,kind:'op-amp',request:'Generate a non-inverting amplifier with gain 11, plus and minus 12 V supplies, and a 10 kilohm gain resistor to ground. Input signal is centered on ground.'},
 {searchId:27,kind:'linear regulator',request:'Generate a 5 V input to 3.3 V output regulator circuit at 100 mA.'},
 {searchId:47,kind:'CAN transceiver',request:'Generate a basic 3.3 V CAN transceiver application circuit, with bypass capacitor, high-speed mode, and 120 ohm bus termination. Expose TX, RX, CANH and CANL connections.'}
];
