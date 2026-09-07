import { View, Text, StyleSheet } from 'react-native';
import { useRegistration } from '@/hooks/useRegistration';
import { useSessionStore } from '@/stores/sessionStore';
import { ProfileForm, type ProfileFormValues } from '@/components/ProfileForm';

export default function CreateProfileScreen() {
  const userId = useSessionStore((s) => s.session?.user.id);
  const { completeProfile, loading, error } = useRegistration();

  function handleSubmit(values: ProfileFormValues) {
    if (!userId) return;
    completeProfile({
      userId,
      firstName: values.firstName,
      lastName: values.lastName,
      birthDate: values.birthDate,
      heightCm: Number(values.heightCm),
      preferredFoot: values.preferredFoot,
      playerRole: values.playerRole,
    });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Crea il tuo profilo</Text>
      <ProfileForm onSubmit={handleSubmit} submitLabel="Crea profilo" loading={loading} error={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 24 },
  title: { fontSize: 28, fontWeight: '700', paddingHorizontal: 24 },
});
