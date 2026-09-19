import { useState } from 'react';
import { View, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRegistration } from '@/hooks/useRegistration';
import { colors } from '@/theme';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthUnderlineField } from '@/components/auth/AuthUnderlineField';
import { AuthButton } from '@/components/auth/AuthButton';
import { AuthError } from '@/components/auth/AuthError';

export default function VerifyOtpScreen() {
  const [token, setToken] = useState('');
  const { confirmOtp, loading, error } = useRegistration();

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.flex}>
        <Animated.View entering={FadeInDown.duration(450)}>
          <AuthHeader eyebrow="Il Decimo" title={'Verifica\nil codice'} />
        </Animated.View>
        <AuthCard>
          <Animated.View entering={FadeInDown.delay(100).duration(400)}>
            <AuthUnderlineField
              style={styles.otpInput}
              label="Codice a 6 cifre"
              keyboardType="number-pad"
              maxLength={6}
              value={token}
              onChangeText={setToken}
            />
          </Animated.View>
          <AuthError message={error} />
          <Animated.View entering={FadeInDown.delay(170).duration(400)}>
            <AuthButton label="Verifica" onPress={() => confirmOtp(token)} loading={loading} />
          </Animated.View>
        </AuthCard>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  otpInput: { fontFamily: 'Archivo_400Regular', fontSize: 22, letterSpacing: 8 },
});
