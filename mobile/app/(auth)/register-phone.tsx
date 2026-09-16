import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRegistration } from '@/hooks/useRegistration';
import { colors, typography, spacing, withPressed } from '@/theme';

export default function RegisterPhoneScreen() {
  const [phone, setPhone] = useState('');
  const { sendOtp, loading, error } = useRegistration();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Il tuo numero</Text>
      <Text style={styles.subtitle}>Ti invieremo un codice via SMS per verificarlo.</Text>
      <TextInput
        style={styles.input}
        placeholder="Numero di telefono"
        placeholderTextColor={colors.muted}
        keyboardType="phone-pad"
        autoComplete="tel"
        value={phone}
        onChangeText={setPhone}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={withPressed(styles.button)} onPress={() => sendOtp(phone)} disabled={loading}>
        {loading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>Invia codice</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  title: { ...typography.authTitle, color: colors.ink, textTransform: 'uppercase' },
  subtitle: { color: colors.muted, marginBottom: spacing.spaceSm, ...typography.body },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, color: colors.ink, ...typography.body },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceXs },
  buttonText: { color: colors.onPrimary, ...typography.label },
  error: { color: colors.danger },
});
