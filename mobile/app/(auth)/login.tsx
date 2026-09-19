import { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Link } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useLogin } from '@/hooks/useLogin';
import { colors, typography, spacing } from '@/theme';
import { PitchDecoration } from '@/components/PitchDecoration';
import { AuthMark } from '@/components/auth/AuthMark';
import { AuthTextInput } from '@/components/auth/AuthTextInput';
import { AuthButton } from '@/components/auth/AuthButton';
import { AuthError } from '@/components/auth/AuthError';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const { login, loading, error } = useLogin();

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.container}>
        <PitchDecoration />
        <Animated.View entering={FadeInDown.duration(500)}>
          <AuthMark />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(80).duration(450)}>
          <Text style={styles.title}>Accedi</Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(150).duration(450)} style={styles.gap}>
          <AuthTextInput
            testID="login-phone-input"
            placeholder="Numero di telefono"
            keyboardType="phone-pad"
            autoComplete="tel"
            value={phone}
            onChangeText={setPhone}
          />
          <AuthTextInput
            testID="login-password-input"
            placeholder="Password"
            secureTextEntry
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
          />
        </Animated.View>
        <AuthError message={error} />
        <Animated.View entering={FadeInDown.delay(220).duration(450)}>
          <AuthButton testID="login-submit-button" label="Accedi" onPress={() => login(phone, password)} loading={loading} />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(280).duration(450)}>
          {/* `as any`: forward-reference to a route Task 5 adds; same pattern as
              the root layout's forward-reference casts (see app/_layout.tsx). */}
          <Link href={'/(auth)/register-phone' as any} style={styles.link}>
            Non hai un account? Registrati
          </Link>
        </Animated.View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  gap: { gap: spacing.spaceSm },
  title: { ...typography.authTitle, color: colors.ink, textTransform: 'uppercase', textAlign: 'center', marginBottom: spacing.spaceSm },
  link: { textAlign: 'center', marginTop: spacing.spaceMd, color: colors.primary },
});
