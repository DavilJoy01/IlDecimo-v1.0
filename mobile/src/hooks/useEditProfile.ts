import { useState } from 'react';
import { updateOwnProfile, uploadProfileImage } from '@/api/users';
import { useSessionStore } from '@/stores/sessionStore';
import type { ProfileFormValues } from '@/components/ProfileForm';

export function useEditProfile() {
  const userId = useSessionStore((s) => s.session?.user.id);
  const profile = useSessionStore((s) => s.profile);
  const setProfile = useSessionStore((s) => s.setProfile);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(values: ProfileFormValues, newImageUri?: string): Promise<boolean> {
    if (!userId) return false;
    setLoading(true);
    setError(null);
    try {
      let profileImageUrl: string | undefined;
      if (newImageUri) {
        profileImageUrl = await uploadProfileImage(userId, newImageUri);
      }
      const updated = await updateOwnProfile(userId, {
        first_name: values.firstName,
        last_name: values.lastName,
        birth_date: values.birthDate,
        height_cm: Number(values.heightCm),
        preferred_foot: values.preferredFoot,
        player_role: values.playerRole,
        ...(profileImageUrl ? { profile_image_url: profileImageUrl } : {}),
      });
      setProfile(updated);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile salvare le modifiche.');
      return false;
    } finally {
      setLoading(false);
    }
  }

  return { profile, loading, error, save };
}
