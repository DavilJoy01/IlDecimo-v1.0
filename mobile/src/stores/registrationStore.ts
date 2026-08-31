import { create } from 'zustand';

interface RegistrationState {
  phone: string;
  setPhone: (phone: string) => void;
}

// useRegistration() is called independently by each screen in the
// registration flow (register-phone, verify-otp, create-password,
// create-profile). Expo Router unmounts one screen and mounts the next on
// navigation, so a plain useState inside the hook would reset `phone` to ''
// on every step after the first -- this store is what survives that.
export const useRegistrationStore = create<RegistrationState>((set) => ({
  phone: '',
  setPhone: (phone) => set({ phone }),
}));
