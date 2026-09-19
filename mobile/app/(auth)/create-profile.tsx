import { useState } from 'react';
import { View, Text, Pressable, Platform, KeyboardAvoidingView, StyleSheet } from 'react-native';
import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { useRegistration } from '@/hooks/useRegistration';
import { useSessionStore } from '@/stores/sessionStore';
import { formatDateInput, parseDateInput } from '@/utils/dateTimeInput';
import { FOOT_LABELS, ROLE_LABELS } from '@/utils/profileDisplay';
import { colors, spacing } from '@/theme';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthUnderlineField } from '@/components/auth/AuthUnderlineField';
import { AuthChipGroup } from '@/components/auth/AuthChipGroup';
import { AuthButton } from '@/components/auth/AuthButton';
import { AuthError } from '@/components/auth/AuthError';

const FEET = ['left', 'right', 'both'] as const;
const ROLES = ['player', 'goalkeeper', 'both'] as const;

export default function CreateProfileScreen() {
  const userId = useSessionStore((s) => s.session?.user.id);
  const { completeProfile, loading, error } = useRegistration();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [preferredFoot, setPreferredFoot] = useState<(typeof FEET)[number]>('right');
  const [playerRole, setPlayerRole] = useState<(typeof ROLES)[number]>('player');
  const [showDatePicker, setShowDatePicker] = useState(false);

  const heightValue = Number(heightCm);
  const isHeightValid = Number.isInteger(heightValue) && heightValue > 0 && heightValue < 250;
  const canSubmit = !!(userId && firstName && lastName && birthDate && heightCm) && isHeightValid;

  function handleDateChange(_event: DateTimePickerChangeEvent, selectedDate: Date) {
    if (Platform.OS === 'android') setShowDatePicker(false);
    setBirthDate(formatDateInput(selectedDate));
  }

  function handleSubmit() {
    if (!userId) return;
    completeProfile({
      userId,
      firstName,
      lastName,
      birthDate,
      heightCm: Number(heightCm),
      preferredFoot,
      playerRole,
    });
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.flex}>
        <AuthHeader eyebrow="Il Decimo" title={'Crea il tuo\nprofilo'} />
        <AuthCard scroll>
          <AuthUnderlineField label="Nome" value={firstName} onChangeText={setFirstName} />
          <AuthUnderlineField label="Cognome" value={lastName} onChangeText={setLastName} />
          <AuthUnderlineField label="Data di nascita" value={birthDate} placeholder="Seleziona una data" onPress={() => setShowDatePicker(true)} />
          {Platform.OS === 'ios' && showDatePicker && (
            <Pressable style={styles.dateDoneButton} onPress={() => setShowDatePicker(false)} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
              <Text style={styles.dateDoneText}>Fatto</Text>
            </Pressable>
          )}
          {showDatePicker && (
            <DateTimePicker
              value={parseDateInput(birthDate)}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              locale="it-IT"
              maximumDate={new Date()}
              onValueChange={handleDateChange}
              onDismiss={() => setShowDatePicker(false)}
              {...(Platform.OS === 'ios' ? { style: styles.iosDatePicker, themeVariant: 'light' as const } : {})}
            />
          )}
          <AuthUnderlineField label="Altezza (cm)" keyboardType="number-pad" value={heightCm} onChangeText={setHeightCm} />
          {!!heightCm && !isHeightValid && <AuthError message="Inserisci un'altezza valida in centimetri (1-249)." />}
          <AuthChipGroup label="Piede preferito" options={FEET} optionLabels={FOOT_LABELS} value={preferredFoot} onChange={setPreferredFoot} />
          <AuthChipGroup label="Ruolo" options={ROLES} optionLabels={ROLE_LABELS} value={playerRole} onChange={setPlayerRole} />
          <AuthError message={error} />
          <AuthButton label="Crea profilo" onPress={handleSubmit} loading={loading} disabled={!canSubmit} />
        </AuthCard>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  iosDatePicker: { alignSelf: 'center' },
  dateDoneButton: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: spacing.spaceXs },
  dateDoneText: { color: colors.background, fontFamily: 'Archivo_600SemiBold', fontSize: 15 },
});
