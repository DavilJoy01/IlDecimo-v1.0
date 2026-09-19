import { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRegistration } from '@/hooks/useRegistration';
import { colors, typography, spacing } from '@/theme';
import { AuthBackdrop } from '@/components/auth/AuthBackdrop';
import { AuthMark } from '@/components/auth/AuthMark';
import { AuthGlassCard } from '@/components/auth/AuthGlassCard';
import { AuthTextInput } from '@/components/auth/AuthTextInput';
import { AuthButton } from '@/components/auth/AuthButton';
import { AuthError } from '@/components/auth/AuthError';

export default function CreatePasswordScreen() {
  const [password, setPassword] = useState('');
  const { choosePassword, loading, error } = useRegistration();

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <AuthBackdrop />
      <View style={styles.container}>
        <Animated.View entering={FadeInDown.duration(600)}>
          <AuthMark />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(80).duration(500)}>
          <Text style={styles.title}>Crea una password</Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(160).duration(500)}>
          <AuthGlassCard>
            <AuthTextInput placeholder="Password" secureTextEntry autoComplete="new-password" value={password} onChangeText={setPassword} />
          </AuthGlassCard>
        </Animated.View>
        <AuthError message={error} />
        <Animated.View entering={FadeInDown.delay(230).duration(500)}>
          <AuthButton label="Continua" onPress={() => choosePassword(password)} loading={loading} disabled={password.length < 8} />
        </Animated.View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  title: {
    ...typography.authTitle,
    fontSize: 30,
    color: colors.ink,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: spacing.spaceSm,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
  },
});
