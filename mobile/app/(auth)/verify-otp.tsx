import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRegistration } from '@/hooks/useRegistration';
import { colors, typography, spacing, withPressed } from '@/theme';

export default function VerifyOtpScreen() {
  const [token, setToken] = useState('');
  const { confirmOtp, loading, error } = useRegistration();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verifica il codice</Text>
      <TextInput
        style={styles.input}
        placeholder="Codice a 6 cifre"
        placeholderTextColor={colors.muted}
        keyboardType="number-pad"
        maxLength={6}
        value={token}
        onChangeText={setToken}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={withPressed(styles.button)} onPress={() => confirmOtp(token)} disabled={loading}>
        {loading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>Verifica</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  title: { ...typography.authTitle, color: colors.ink, textTransform: 'uppercase', marginBottom: spacing.spaceSm },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, color: colors.ink, fontFamily: 'Archivo_400Regular', fontSize: 24, textAlign: 'center', letterSpacing: 8 },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceXs },
  buttonText: { color: colors.onPrimary, ...typography.label },
  error: { color: colors.danger },
});
