import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRegistration } from '@/hooks/useRegistration';
import { useSessionStore } from '@/stores/sessionStore';
import { ProfileForm, type ProfileFormValues } from '@/components/ProfileForm';
import { colors, typography, spacing } from '@/theme';

export default function CreateProfileScreen() {
  const insets = useSafeAreaInsets();
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
    <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.title}>Crea il tuo profilo</Text>
      <ProfileForm onSubmit={handleSubmit} submitLabel="Crea profilo" loading={loading} error={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1 },
  title: { ...typography.authTitle, paddingHorizontal: spacing.spaceLg },
});
