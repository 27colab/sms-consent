import { describe, expect, it } from 'vitest';
import { classifyInbound, normalizeText, type InboundKeyword } from '../src/index.js';

const cases: [string, InboundKeyword][] = [
  // STOP family
  ['STOP', 'STOP'], ['stop', 'STOP'], ['Stop', 'STOP'], ['sToP', 'STOP'], ['STOP.', 'STOP'], ['stop!', 'STOP'],
  ['  stop  ', 'STOP'], ['\nSTOP\n', 'STOP'], ['"stop"', 'STOP'], ['¡stop!', 'STOP'], ['STOP 🙏', 'STOP'],
  ['STOPALL', 'STOP'], ['stopall', 'STOP'], ['UNSUBSCRIBE', 'STOP'], ['unsubscribe me', 'STOP'], ['CANCEL', 'STOP'],
  ['END', 'STOP'], ['QUIT', 'STOP'], ['optout', 'STOP'], ['opt out', 'STOP'], ['revoke', 'STOP'],
  ['stop texting me', 'STOP'], ['please stop', 'STOP'], ['yes stop', 'STOP'], ['s​top', 'STOP'],
  ['ＳＴＯＰ', 'STOP'],
  // STOP, Spanish
  ['PARAR', 'STOP'], ['parar mensajes', 'STOP'], ['detener', 'STOP'], ['CANCELAR', 'STOP'], ['baja', 'STOP'],
  ['basta', 'STOP'], ['salir', 'STOP'], ['por favor basta', 'STOP'], ['ALTO', 'STOP'],
  // START family
  ['START', 'START'], ['start', 'START'], ['Start.', 'START'], ['UNSTOP', 'START'], ['unstop', 'START'],
  ['resubscribe', 'START'], ['comenzar', 'START'], ['  START please', 'START'],
  // HELP
  ['HELP', 'HELP'], ['help', 'HELP'], ['Help!', 'HELP'], ['info', 'HELP'], ['AYUDA', 'HELP'], ['help me', 'HELP'],
  // YES
  ['YES', 'YES'], ['yes', 'YES'], ['Y', 'YES'], ['y', 'YES'], ['yes!', 'YES'], ['yep', 'YES'], ['si', 'YES'],
  ['sí', 'YES'], ['SÍ', 'YES'], ['confirm', 'YES'], ['yes please', 'YES'],
  // OTHER
  ['', 'OTHER'], ['   ', 'OTHER'], ['...', 'OTHER'], ['ok', 'OTHER'], ['sure', 'OTHER'], ['thanks', 'OTHER'],
  ['what time is my appointment tomorrow', 'OTHER'], ['I can never stop thinking about it', 'OTHER'],
  ['stopping by later', 'OTHER'], ['the end of the month works', 'OTHER'], ['hello', 'OTHER'], ['12345', 'OTHER'],
];

describe('classifyInbound', () => {
  it('has a large matrix', () => expect(cases.length).toBeGreaterThanOrEqual(60));
  it.each(cases)('%j -> %s', (input, expected) => {
    expect(classifyInbound(input)).toBe(expected);
  });

  it('accepts extra words per category', () => {
    expect(classifyInbound('arrêtez', { stop: ['arretez'] })).toBe('STOP');
    expect(classifyInbound('commencer', { start: ['commencer'] })).toBe('START');
    expect(classifyInbound('aide', { help: ['aide'] })).toBe('HELP');
    expect(classifyInbound('oui', { yes: ['oui'] })).toBe('YES');
    expect(classifyInbound('commencer')).toBe('OTHER');
  });

  it('opt-out wins over other keywords', () => {
    expect(classifyInbound('start stop')).toBe('STOP');
  });
});

describe('normalizeText', () => {
  it('strips accents, punctuation and case', () => {
    expect(normalizeText('  ¡Sí,   CANCELAR!  ')).toBe('si cancelar');
  });
});
