import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRegistration } from '@/hooks/useRegistration';
import { colors, typography, spacing } from '@/theme';

export default function CreatePasswordScreen() {
  const [password, setPassword] = useState('');
  const { choosePassword, loading, error } = useRegistration();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Crea una password</Text>
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        autoComplete="new-password"
        value={password}
        onChangeText={setPassword}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={() => choosePassword(password)} disabled={loading || password.length < 8}>
        {loading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>Continua</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  title: { ...typography.authTitle, marginBottom: spacing.spaceSm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, ...typography.body },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceXs },
  buttonText: { color: colors.onPrimary, ...typography.label },
  error: { color: colors.danger },
});
