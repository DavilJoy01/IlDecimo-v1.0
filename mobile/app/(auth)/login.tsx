import { useState } from 'react';
import { View, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Link } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useLogin } from '@/hooks/useLogin';
import { colors } from '@/theme';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthUnderlineField } from '@/components/auth/AuthUnderlineField';
import { AuthButton } from '@/components/auth/AuthButton';
import { AuthError } from '@/components/auth/AuthError';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const { login, loading, error } = useLogin();

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.flex}>
        <Animated.View entering={FadeInDown.duration(450)}>
          <AuthHeader eyebrow="Il Decimo" title={'Ciao,\nbentornato!'} />
        </Animated.View>
        <AuthCard>
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.fields}>
            <AuthUnderlineField
              testID="login-phone-input"
              label="Numero di telefono"
              keyboardType="phone-pad"
              autoComplete="tel"
              value={phone}
              onChangeText={setPhone}
            />
            <AuthUnderlineField
              testID="login-password-input"
              label="Password"
              secureTextEntry
              autoComplete="password"
              value={password}
              onChangeText={setPassword}
            />
          </Animated.View>
          <AuthError message={error} />
          <Animated.View entering={FadeInDown.delay(170).duration(400)}>
            <AuthButton testID="login-submit-button" label="Accedi" onPress={() => login(phone, password)} loading={loading} />
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(220).duration(400)}>
            {/* `as any`: forward-reference to a route Task 5 adds; same pattern as
                the root layout's forward-reference casts (see app/_layout.tsx). */}
            <Link href={'/(auth)/register-phone' as any} style={styles.link}>
              Non hai un account? Registrati
            </Link>
          </Animated.View>
        </AuthCard>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  fields: { gap: 18 },
  link: { textAlign: 'center', marginTop: 4, color: colors.background, fontWeight: '600' },
});
