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

export default function RegisterPhoneScreen() {
  const [phone, setPhone] = useState('');
  const { sendOtp, loading, error } = useRegistration();

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.flex}>
        <Animated.View entering={FadeInDown.duration(450)}>
          <AuthHeader eyebrow="Il Decimo" title={'Il tuo\nnumero'} subtitle="Ti invieremo un codice via SMS per verificarlo." />
        </Animated.View>
        <AuthCard>
          <Animated.View entering={FadeInDown.delay(100).duration(400)}>
            <AuthUnderlineField label="Numero di telefono" keyboardType="phone-pad" autoComplete="tel" value={phone} onChangeText={setPhone} />
          </Animated.View>
          <AuthError message={error} />
          <Animated.View entering={FadeInDown.delay(170).duration(400)}>
            <AuthButton label="Invia codice" onPress={() => sendOtp(phone)} loading={loading} />
          </Animated.View>
        </AuthCard>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
});
