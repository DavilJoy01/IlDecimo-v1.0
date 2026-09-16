import { useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEditProfile } from '@/hooks/useEditProfile';
import { useDeleteAccount } from '@/hooks/useDeleteAccount';
import { ProfileForm, type ProfileFormValues } from '@/components/ProfileForm';
import { colors, typography, spacing, withPressed } from '@/theme';

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, loading, error, save } = useEditProfile();
  const [selectedImageUri, setSelectedImageUri] = useState<string | undefined>(undefined);
  const { deleteAccount, loading: deleting, error: deleteError } = useDeleteAccount();
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [password, setPassword] = useState('');

  if (!profile) return null; // unreachable in practice: this screen is only mounted once status === 'signed-in'

  async function handleSubmit(values: ProfileFormValues) {
    const success = await save(values, selectedImageUri);
    if (success) router.back();
  }

  function confirmDelete() {
    Alert.alert(
      'Elimina il tuo account',
      'Questa azione è irreversibile. Le partite che hai creato verranno cancellate; i messaggi che hai inviato resteranno visibili ma anonimi. Vuoi continuare?',
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Continua', style: 'destructive', onPress: () => setShowPasswordPrompt(true) },
      ]
    );
  }

  async function handleConfirmDelete() {
    const success = await deleteAccount(password);
    if (success) router.replace('/(auth)/login');
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
        <View style={styles.dangerZone}>
          <Pressable onPress={confirmDelete} disabled={deleting}>
            <Text style={styles.dangerLink}>Elimina account</Text>
          </Pressable>
          {showPasswordPrompt && (
            <View style={styles.passwordPrompt}>
              <Text style={styles.passwordLabel}>Inserisci la password attuale per confermare</Text>
              <TextInput
                style={styles.passwordInput}
                placeholder="Password"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                autoFocus
              />
              {deleteError && <Text style={styles.deleteError}>{deleteError}</Text>}
              <Pressable style={withPressed(styles.confirmDeleteButton)} disabled={deleting} onPress={handleConfirmDelete}>
                {deleting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.confirmDeleteText}>Conferma eliminazione</Text>}
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  header: { ...typography.screenTitle, color: colors.ink, marginBottom: 4 },
  dangerZone: { marginTop: spacing.spaceLg, paddingTop: spacing.spaceMd, borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: spacing.spaceLg },
  dangerLink: { color: colors.danger, ...typography.label, textAlign: 'center' },
  passwordPrompt: { marginTop: spacing.spaceMd, gap: spacing.spaceSm },
  passwordLabel: { color: colors.muted, ...typography.body },
  passwordInput: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, color: colors.ink, ...typography.body },
  deleteError: { color: colors.danger },
  confirmDeleteButton: { backgroundColor: colors.danger, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center' },
  confirmDeleteText: { color: colors.onPrimary, ...typography.label },
});
