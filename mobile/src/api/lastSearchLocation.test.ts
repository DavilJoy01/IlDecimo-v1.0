import * as SecureStore from 'expo-secure-store';
import { getLastSearchLocation, saveLastSearchLocation } from './lastSearchLocation';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

describe('lastSearchLocation', () => {
  afterEach(() => jest.clearAllMocks());

  it('saves a location as JSON under the expected key', async () => {
    await saveLastSearchLocation({ label: 'Milano', latitude: 45.4642, longitude: 9.19 });

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'last-search-location',
      JSON.stringify({ label: 'Milano', latitude: 45.4642, longitude: 9.19 })
    );
  });

  it('reads back a previously saved location', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(
      JSON.stringify({ label: 'Milano', latitude: 45.4642, longitude: 9.19 })
    );

    const result = await getLastSearchLocation();

    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('last-search-location');
    expect(result).toEqual({ label: 'Milano', latitude: 45.4642, longitude: 9.19 });
  });

  it('returns null when nothing has been saved yet', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

    const result = await getLastSearchLocation();

    expect(result).toBeNull();
  });

  it('returns null instead of throwing when the stored value is corrupted', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('{not valid json');

    const result = await getLastSearchLocation();

    expect(result).toBeNull();
  });
});
