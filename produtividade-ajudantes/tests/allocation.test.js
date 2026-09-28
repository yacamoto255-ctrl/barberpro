'use strict';
// Testes unitários do motor de rateio (regra de negócio central).
const { allocate, distributeCents } = require('../src/domain/allocation');

const equal = { method: 'RATEIO_IGUAL', weight_factor: 1, volume_factor: 1 };
const ps = (n, secs = 60) => Array.from({ length: n }, (_, i) => ({ helper_id: i + 1, worked_seconds: secs }));
const sum = (rows, k) => Math.round(rows.reduce((a, r) => a + r[k] * 100, 0)) / 100;

describe('Rateio igual (regra inicial da operação)', () => {
  test('1 ajudante recebe 1.000 kg', () => {
    const r = allocate(equal, { weight_kg: 1000, volumes: 120 }, ps(1));
    expect(r[0].allocated_weight_kg).toBe(1000);
    expect(r[0].allocated_volumes).toBe(120);
    expect(r[0].participants_count).toBe(1);
  });
  test('2 ajudantes recebem 500 kg cada', () => {
    const r = allocate(equal, { weight_kg: 1000, volumes: 120 }, ps(2));
    expect(r.map(x => x.allocated_weight_kg)).toEqual([500, 500]);
    expect(r.map(x => x.allocated_volumes)).toEqual([60, 60]);
  });
  test('3 ajudantes: 333,33 / 333,33 / 333,34 (resto para o último)', () => {
    const r = allocate(equal, { weight_kg: 1000, volumes: 120 }, ps(3));
    expect(r.map(x => x.allocated_weight_kg)).toEqual([333.33, 333.33, 333.34]);
    expect(r.map(x => x.allocated_volumes)).toEqual([40, 40, 40]);
  });
  test('volumes não divisíveis: 121 / 3', () => {
    const r = allocate(equal, { weight_kg: 1000, volumes: 121 }, ps(3));
    expect(sum(r, 'allocated_volumes')).toBe(121);
    expect(r.map(x => x.allocated_volumes)).toEqual([40.33, 40.33, 40.34]);
  });
  test('peso zero e lista vazia', () => {
    expect(allocate(equal, { weight_kg: 0, volumes: 0 }, ps(2)).map(x => x.allocated_weight_kg)).toEqual([0, 0]);
    expect(allocate(equal, { weight_kg: 1000, volumes: 1 }, [])).toEqual([]);
  });
  test('a soma sempre fecha com o peso de referência (propriedade, 2.000 casos)', () => {
    for (let i = 0; i < 2000; i++) {
      const w = Math.round(Math.random() * 1e7) / 100;
      const v = Math.floor(Math.random() * 5000);
      const n = 1 + Math.floor(Math.random() * 12);
      const r = allocate(equal, { weight_kg: w, volumes: v }, ps(n));
      expect(sum(r, 'allocated_weight_kg')).toBeCloseTo(w, 2);
      expect(sum(r, 'allocated_volumes')).toBeCloseTo(v, 2);
      const vals = r.map(x => x.allocated_weight_kg);
      expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(0.011);
    }
  });
});

describe('Regras configuráveis', () => {
  test('fator 0,5 conta metade do peso', () => {
    const r = allocate({ ...equal, weight_factor: 0.5 }, { weight_kg: 1000, volumes: 100 }, ps(2));
    expect(r.map(x => x.allocated_weight_kg)).toEqual([250, 250]);
    expect(r.map(x => x.allocated_volumes)).toEqual([50, 50]);
  });
  test('proporcional ao tempo: 30 min x 10 min => 750 / 250', () => {
    const r = allocate({ method: 'PROPORCIONAL_TEMPO', weight_factor: 1, volume_factor: 1 }, { weight_kg: 1000, volumes: 100 },
      [{ helper_id: 1, worked_seconds: 1800 }, { helper_id: 2, worked_seconds: 600 }]);
    expect(r.map(x => x.allocated_weight_kg)).toEqual([750, 250]);
    expect(r.map(x => x.share)).toEqual([0.75, 0.25]);
  });
  test('proporcional ao tempo sem tempo registrado cai para rateio igual', () => {
    const r = allocate({ method: 'PROPORCIONAL_TEMPO' }, { weight_kg: 1000, volumes: 0 }, ps(2, 0));
    expect(r.map(x => x.allocated_weight_kg)).toEqual([500, 500]);
  });
  test('crédito integral: cada um recebe o total', () => {
    const r = allocate({ method: 'CREDITO_INTEGRAL', weight_factor: 1, volume_factor: 1 }, { weight_kg: 1000, volumes: 120 }, ps(3));
    expect(r.map(x => x.allocated_weight_kg)).toEqual([1000, 1000, 1000]);
  });
  test('método desconhecido gera erro', () => {
    expect(() => allocate({ method: 'XYZ' }, { weight_kg: 1, volumes: 1 }, ps(1))).toThrow();
  });
  test('distributeCents pelo maior resto', () => {
    expect(distributeCents(100, [1, 1, 1])).toEqual([33, 33, 34]);
    expect(distributeCents(10, [0, 0])).toEqual([0, 0]);
  });
});
