import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEditProfile } from '@/hooks/useEditProfile';
import { ProfileForm, type ProfileFormValues } from '@/components/ProfileForm';

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, loading, error, save } = useEditProfile();
  const [selectedImageUri, setSelectedImageUri] = useState<string | undefined>(undefined);

  if (!profile) return null; // unreachable in practice: this screen is only mounted once status === 'signed-in'

  async function handleSubmit(values: ProfileFormValues) {
    const success = await save(values, selectedImageUri);
    if (success) router.back();
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.backLink}>← Torna al profilo</Text>
      </Pressable>
      <Text style={styles.header}>Modifica profilo</Text>
      <ProfileForm
        initialValues={{
          firstName: profile.first_name,
          lastName: profile.last_name,
          birthDate: profile.birth_date,
          heightCm: String(profile.height_cm),
          preferredFoot: profile.preferred_foot,
          playerRole: profile.player_role,
        }}
        currentImageUrl={profile.profile_image_url}
        showImagePicker
        onImageSelected={setSelectedImageUri}
        onSubmit={handleSubmit}
        submitLabel="Salva modifiche"
        loading={loading}
        error={error}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  backLink: { color: '#1a7f37', marginBottom: 8 },
  header: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
});
