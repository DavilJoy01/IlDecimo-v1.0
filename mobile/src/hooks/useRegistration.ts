import { useState } from 'react';
import { router } from 'expo-router';
import { requestPhoneOtp, verifyPhoneOtp, setPassword } from '@/api/auth';
import { createOwnProfile } from '@/api/users';
import { useSessionStore } from '@/stores/sessionStore';
import { useRegistrationStore } from '@/stores/registrationStore';

export function useRegistration() {
  const phone = useRegistrationStore((s) => s.phone);
  const setPhoneState = useRegistrationStore((s) => s.setPhone);
  const session = useSessionStore((s) => s.session);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setProfile = useSessionStore((s) => s.setProfile);

  async function sendOtp(phoneNumber: string) {
    setLoading(true);
    setError(null);
    try {
      await requestPhoneOtp(phoneNumber);
      setPhoneState(phoneNumber);
      router.push('/(auth)/verify-otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invio del codice non riuscito.');
    } finally {
      setLoading(false);
    }
  }

  async function confirmOtp(token: string) {
    setLoading(true);
    setError(null);
    try {
      await verifyPhoneOtp(phone, token);
      router.push('/(auth)/create-password');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Codice non valido.');
    } finally {
      setLoading(false);
    }
  }

  async function choosePassword(password: string) {
    setLoading(true);
    setError(null);
    try {
      await setPassword(password);
      router.push('/(auth)/create-profile');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impostazione password non riuscita.');
    } finally {
      setLoading(false);
    }
  }

  async function completeProfile(input: {
    userId: string;
    firstName: string;
    lastName: string;
    birthDate: string;
    heightCm: number;
    preferredFoot: 'left' | 'right' | 'both';
    playerRole: 'player' | 'goalkeeper' | 'both';
  }) {
    setLoading(true);
    setError(null);
    try {
      // registrationStore.phone is only populated when sendOtp ran in this app
      // session. A user who reaches this screen via session restore (killed the
      // app mid-registration) or via login (no profile row yet) never called
      // sendOtp, so fall back to the session's own phone claim -- GoTrue
      // normalizes it without a leading '+', so re-add one to match the format
      // registrationStore/the rest of this flow already uses.
      const sessionPhone = session?.user.phone ? `+${session.user.phone.replace(/^\+/, '')}` : '';
      const resolvedPhone = phone || sessionPhone;
      if (!resolvedPhone) {
        setError('Numero di telefono mancante. Prova a rifare la registrazione dal numero di telefono.');
        return;
      }
      const profile = await createOwnProfile({
        id: input.userId,
        phone: resolvedPhone,
        first_name: input.firstName,
        last_name: input.lastName,
        birth_date: input.birthDate,
        height_cm: input.heightCm,
        preferred_foot: input.preferredFoot,
        player_role: input.playerRole,
      });
      setProfile(profile);
      setPhoneState(''); // clear now that it's persisted, so it can't leak into a later account
      // Root layout (Task 3) redirects to /(tabs)/home once status becomes 'signed-in'.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creazione del profilo non riuscita.');
    } finally {
      setLoading(false);
    }
  }

  return { phone, loading, error, sendOtp, confirmOtp, choosePassword, completeProfile };
}
