import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Link } from 'expo-router';
import { useLogin } from '@/hooks/useLogin';
import { colors, typography, spacing, withPressed } from '@/theme';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const { login, loading, error } = useLogin();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Accedi</Text>
      <TextInput
        testID="login-phone-input"
        style={styles.input}
        placeholder="Numero di telefono"
        keyboardType="phone-pad"
        autoComplete="tel"
        value={phone}
        onChangeText={setPhone}
      />
      <TextInput
        testID="login-password-input"
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        testID="login-submit-button"
        style={withPressed(styles.button)}
        onPress={() => login(phone, password)}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>Accedi</Text>}
      </Pressable>
      {/* `as any`: forward-reference to a route Task 5 adds; same pattern as
          the root layout's forward-reference casts (see app/_layout.tsx). */}
      <Link href={'/(auth)/register-phone' as any} style={styles.link}>
        Non hai un account? Registrati
      </Link>
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
  link: { textAlign: 'center', marginTop: spacing.spaceMd, color: colors.primary },
});
