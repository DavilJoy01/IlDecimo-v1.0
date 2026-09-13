import * as Location from 'expo-location';
import { geocodeAddress } from './geocoding';

jest.mock('expo-location');

describe('geocodeAddress', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns the coordinates of the only geocoding result', async () => {
    (Location.geocodeAsync as jest.Mock).mockResolvedValue([{ latitude: 45.4642, longitude: 9.19 }]);

    const result = await geocodeAddress('Milano');

    expect(Location.geocodeAsync).toHaveBeenCalledWith('Milano');
    expect(result).toEqual({ latitude: 45.4642, longitude: 9.19 });
  });

  it('returns the first result when geocoding finds more than one match', async () => {
    (Location.geocodeAsync as jest.Mock).mockResolvedValue([
      { latitude: 45.4642, longitude: 9.19 },
      { latitude: 43.077, longitude: -89.401 },
    ]);

    const result = await geocodeAddress('Milano');

    expect(result).toEqual({ latitude: 45.4642, longitude: 9.19 });
  });

  it('throws an Italian error when geocoding finds no results', async () => {
    (Location.geocodeAsync as jest.Mock).mockResolvedValue([]);

    await expect(geocodeAddress('asdkjhasdkjh')).rejects.toThrow(
      'Località non trovata, prova a essere più specifico.'
    );
  });
});
