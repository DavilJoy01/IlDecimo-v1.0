import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { geocodeAddress } from './geocoding';

jest.mock('expo-location');

describe('geocodeAddress', () => {
  afterEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
  });

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

  it('does not request location permission on iOS', async () => {
    Platform.OS = 'ios';
    (Location.geocodeAsync as jest.Mock).mockResolvedValue([{ latitude: 45.4642, longitude: 9.19 }]);

    await geocodeAddress('Milano');

    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('requests foreground location permission on Android before geocoding', async () => {
    Platform.OS = 'android';
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.geocodeAsync as jest.Mock).mockResolvedValue([{ latitude: 45.4642, longitude: 9.19 }]);

    const result = await geocodeAddress('Milano');

    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
    expect(Location.geocodeAsync).toHaveBeenCalledWith('Milano');
    expect(result).toEqual({ latitude: 45.4642, longitude: 9.19 });
  });

  it('throws the Italian not-found error on Android when permission is denied, without calling geocodeAsync', async () => {
    Platform.OS = 'android';
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

    await expect(geocodeAddress('Milano')).rejects.toThrow(
      'Località non trovata, prova a essere più specifico.'
    );
    expect(Location.geocodeAsync).not.toHaveBeenCalled();
  });

  it('propagates a native exception thrown by geocodeAsync itself (e.g. no geocoder backend on device)', async () => {
    Platform.OS = 'android';
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.geocodeAsync as jest.Mock).mockRejectedValue(new Error('NoGeocodeException'));

    await expect(geocodeAddress('Milano')).rejects.toThrow('NoGeocodeException');
  });
});
