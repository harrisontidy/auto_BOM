// Retrieval categories broaden discovery; the original request still governs review.
export function discoveryIntent(component) {
  const text = String(component.originalQuery || '');
  // A requested IC may drive a display or read a sensor. Its application is not its category.
  if (/\b(mcu|microcontroller|microprocessor)\b/i.test(component.componentType || '')
    || (/^(?:component|integrated circuit|IC)?$/i.test(component.componentType || '')
      && /\b(?:find|get|need|want|looking for)\b[^.!?]*?\b(?:mcu|microcontroller|microprocessor)\b/i.test(text))) return null;
  if (/\b(lcd|oled|display|screen)\b/i.test(text) && !/\b(driver|controller|connector)\b/i.test(text)) {
    const lcd = /\bLCD\b/i.test(text), oled = /\bOLED\b/i.test(text);
    return { queries: lcd ? ['LCD Screens', 'LCD Display', 'OLED Display'] : oled ? ['OLED Display'] : ['OLED Display', 'LCD Screens'],
      category: /(?:LCD (?:Screens|Display)|OLED Display)/i,
      note: 'Check display size, resolution, interface, supply, connector and power use for the enclosure.',
      alternative: candidate => lcd && /OLED Display/i.test(candidate.description || '')
        ? 'Alternative technology: OLED, not the requested LCD. Confirm this change before choosing.' : '' };
  }
  if (/\bmicrophone\b/i.test(text)) return {queries:['Microphones'],category:/\bMicrophones\b/i};
  if (/\baccelerometer\b/i.test(text)) return {queries:['Accelerometers'],category:/\bAccelerometers\b/i};
  if (/\b(?:vibration|haptic) motor\b/i.test(text)) return {queries:['Vibration Motors','Motors'],category:/\bMotors\b/i};
  return null;
}
