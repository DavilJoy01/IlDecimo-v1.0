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

export default function CreatePasswordScreen() {
  const [password, setPassword] = useState('');
  const { choosePassword, loading, error } = useRegistration();

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.flex}>
        <Animated.View entering={FadeInDown.duration(450)}>
          <AuthHeader eyebrow="Il Decimo" title={'Crea una\npassword'} />
        </Animated.View>
        <AuthCard>
          <Animated.View entering={FadeInDown.delay(100).duration(400)}>
            <AuthUnderlineField label="Password" secureTextEntry autoComplete="new-password" value={password} onChangeText={setPassword} />
          </Animated.View>
          <AuthError message={error} />
          <Animated.View entering={FadeInDown.delay(170).duration(400)}>
            <AuthButton label="Continua" onPress={() => choosePassword(password)} loading={loading} disabled={password.length < 8} />
          </Animated.View>
        </AuthCard>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
});
