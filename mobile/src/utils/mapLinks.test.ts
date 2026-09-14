import { Platform, Linking } from 'react-native';
import { directionsUrl, openDirections } from './mapLinks';

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Linking: { openURL: jest.fn() },
}));

describe('directionsUrl', () => {
  afterEach(() => {
    Platform.OS = 'ios';
  });

  it('builds an Apple Maps URL on iOS', () => {
    Platform.OS = 'ios';
    expect(directionsUrl(45.4642, 9.19)).toBe('https://maps.apple.com/?daddr=45.4642,9.19');
  });

  it('builds a Google Maps directions URL on Android', () => {
    Platform.OS = 'android';
    expect(directionsUrl(45.4642, 9.19)).toBe('https://www.google.com/maps/dir/?api=1&destination=45.4642,9.19');
  });
});

describe('openDirections', () => {
  afterEach(() => jest.clearAllMocks());

  it('opens the directions URL for the given coordinates', async () => {
    Platform.OS = 'ios';
    await openDirections(45.4642, 9.19);
    expect(Linking.openURL).toHaveBeenCalledWith('https://maps.apple.com/?daddr=45.4642,9.19');
  });
});
