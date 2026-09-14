import { regionForPins } from './mapRegion';

describe('regionForPins', () => {
  it('centers on the single pin with the minimum delta when there is only one', () => {
    const region = regionForPins([{ id: 'm1', latitude: 45.4642, longitude: 9.19 }]);
    expect(region.latitude).toBe(45.4642);
    expect(region.longitude).toBe(9.19);
    expect(region.latitudeDelta).toBe(0.05);
    expect(region.longitudeDelta).toBe(0.05);
  });

  it('centers between two pins and scales the delta to their spread, with padding', () => {
    const region = regionForPins([
      { id: 'm1', latitude: 45.0, longitude: 9.0 },
      { id: 'm2', latitude: 46.0, longitude: 10.0 },
    ]);
    expect(region.latitude).toBe(45.5);
    expect(region.longitude).toBe(9.5);
    expect(region.latitudeDelta).toBeCloseTo(1.4, 5);
    expect(region.longitudeDelta).toBeCloseTo(1.4, 5);
  });

  it('clamps the delta to the minimum when pins are very close together', () => {
    const region = regionForPins([
      { id: 'm1', latitude: 45.0, longitude: 9.0 },
      { id: 'm2', latitude: 45.0001, longitude: 9.0001 },
    ]);
    expect(region.latitudeDelta).toBe(0.05);
    expect(region.longitudeDelta).toBe(0.05);
  });

  it('falls back to a default region centered on Rome when there are no pins', () => {
    const region = regionForPins([]);
    expect(region.latitude).toBe(41.9028);
    expect(region.longitude).toBe(12.4964);
    expect(region.latitudeDelta).toBe(0.05);
    expect(region.longitudeDelta).toBe(0.05);
  });
});
