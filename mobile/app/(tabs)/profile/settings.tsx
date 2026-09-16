import { useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useBlockedUsers } from '@/hooks/useBlockedUsers';
import { useChangePassword } from '@/hooks/useChangePassword';
import { colors, typography, spacing, withPressed } from '@/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const blockedUsers = useBlockedUsers();
  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  async function handleChangePassword() {
    const success = await changePassword.changePassword(currentPassword, newPassword);
    if (success) {
      setCurrentPassword('');
      setNewPassword('');
      Alert.alert('Password aggiornata', 'La tua password è stata cambiata con successo.');
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Pressable onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.backLink}>← Torna al profilo</Text>
      </Pressable>
      <Text style={styles.header}>Impostazioni</Text>

      <FlatList
        data={blockedUsers.blockedUsers}
        keyExtractor={(item) => item.user_id}
        ListHeaderComponent={
          <Text style={styles.sectionTitle}>Utenti bloccati</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.blockedRow}>
            <View>
              <Text style={styles.blockedName}>{item.first_name} {item.last_name}</Text>
              <Text style={styles.blockedCode}>{item.unique_user_id}</Text>
            </View>
            <Pressable
              style={withPressed(styles.unblockButton)}
              onPress={() => blockedUsers.unblock(item.user_id)}
            >
              <Text style={styles.unblockButtonText}>Sblocca</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          !blockedUsers.loading ? <Text style={styles.subtitle}>Non hai bloccato nessun utente.</Text> : null
        }
        ListFooterComponent={
          <View style={styles.passwordSection}>
            {blockedUsers.error && <Text style={styles.error}>{blockedUsers.error}</Text>}
            <Text style={styles.sectionTitle}>Cambia password</Text>
            <TextInput
              style={styles.input}
              placeholder="Password attuale"
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoComplete="current-password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
            />
            <TextInput
              style={styles.input}
              placeholder="Nuova password"
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoComplete="new-password"
              value={newPassword}
              onChangeText={setNewPassword}
            />
            {changePassword.error && <Text style={styles.error}>{changePassword.error}</Text>}
            <Pressable
              style={withPressed(styles.submitButton)}
              disabled={changePassword.loading || !currentPassword || newPassword.length < 8}
              onPress={handleChangePassword}
            >
              {changePassword.loading ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.submitButtonText}>Cambia password</Text>
              )}
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceLg },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  header: { ...typography.screenTitle, color: colors.ink, marginBottom: spacing.spaceMd },
  sectionTitle: { ...typography.label, fontSize: 18, color: colors.ink, marginBottom: spacing.spaceSm },
  subtitle: { color: colors.muted, marginBottom: spacing.spaceMd, ...typography.body },
  error: { color: colors.danger, marginBottom: spacing.spaceSm },
  blockedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.spaceSm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  blockedName: { ...typography.label, color: colors.ink },
  blockedCode: { color: colors.muted, ...typography.meta, marginTop: 2 },
  unblockButton: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, paddingVertical: 6, paddingHorizontal: spacing.spaceSm },
  unblockButtonText: { color: colors.ink, ...typography.label, fontSize: 13 },
  passwordSection: { marginTop: spacing.spaceLg, gap: spacing.spaceSm },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, color: colors.ink, ...typography.body },
  submitButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceXs },
  submitButtonText: { color: colors.onPrimary, ...typography.label },
});
