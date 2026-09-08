import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Image, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { FOOT_LABELS, ROLE_LABELS } from '@/utils/profileDisplay';
import { colors, typography, spacing, withPressed } from '@/theme';

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInput(value: string): Date {
  // Parse the YYYY-MM-DD parts directly into a local-time Date instead of
  // `new Date(value)`, which treats a date-only string as UTC midnight --
  // that reads back one day earlier than formatDateInput's local getters
  // would produce for any timezone west of UTC.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(2000, 0, 1);
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

const FEET = ['left', 'right', 'both'] as const;
const ROLES = ['player', 'goalkeeper', 'both'] as const;

export interface ProfileFormValues {
  firstName: string;
  lastName: string;
  birthDate: string;
  heightCm: string;
  preferredFoot: (typeof FEET)[number];
  playerRole: (typeof ROLES)[number];
}

interface ProfileFormProps {
  initialValues?: ProfileFormValues;
  currentImageUrl?: string | null;
  showImagePicker?: boolean;
  onImageSelected?: (localUri: string) => void;
  onSubmit: (values: ProfileFormValues) => void;
  submitLabel: string;
  loading?: boolean;
  error?: string | null;
}

export function ProfileForm({
  initialValues,
  currentImageUrl,
  showImagePicker,
  onImageSelected,
  onSubmit,
  submitLabel,
  loading,
  error,
}: ProfileFormProps) {
  const [firstName, setFirstName] = useState(initialValues?.firstName ?? '');
  const [lastName, setLastName] = useState(initialValues?.lastName ?? '');
  const [birthDate, setBirthDate] = useState(initialValues?.birthDate ?? '');
  const [heightCm, setHeightCm] = useState(initialValues?.heightCm ?? '');
  const [preferredFoot, setPreferredFoot] = useState<(typeof FEET)[number]>(initialValues?.preferredFoot ?? 'right');
  const [playerRole, setPlayerRole] = useState<(typeof ROLES)[number]>(initialValues?.playerRole ?? 'player');
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const heightValue = Number(heightCm);
  const isHeightValid = Number.isInteger(heightValue) && heightValue > 0 && heightValue < 250;
  const canSubmit = !!(firstName && lastName && birthDate && heightCm) && isHeightValid;

  async function handlePickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      setPreviewUri(result.assets[0].uri);
      onImageSelected?.(result.assets[0].uri);
    }
  }

  function handleDateChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (event.type === 'set' && selectedDate) setBirthDate(formatDateInput(selectedDate));
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {showImagePicker && (
        <Pressable style={styles.avatarWrapper} onPress={handlePickImage}>
          {previewUri || currentImageUrl ? (
            <Image source={{ uri: previewUri ?? currentImageUrl ?? undefined }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarPlaceholderText}>{firstName ? firstName.charAt(0).toUpperCase() : '?'}</Text>
            </View>
          )}
          <Text style={styles.avatarHint}>Tocca per cambiare foto</Text>
        </Pressable>
      )}
      <TextInput style={styles.input} placeholder="Nome" value={firstName} onChangeText={setFirstName} />
      <TextInput style={styles.input} placeholder="Cognome" value={lastName} onChangeText={setLastName} />
      <Pressable style={styles.input} onPress={() => setShowDatePicker(true)}>
        <Text style={birthDate ? styles.dateValue : styles.datePlaceholder}>{birthDate || 'Data di nascita'}</Text>
      </Pressable>
      {showDatePicker && (
        <DateTimePicker
          value={parseDateInput(birthDate)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          locale="it-IT"
          maximumDate={new Date()}
          onChange={handleDateChange}
          {...(Platform.OS === 'ios' ? { style: styles.iosDatePicker } : {})}
        />
      )}
      {Platform.OS === 'ios' && showDatePicker && (
        <Pressable
          style={styles.dateDoneButton}
          onPress={() => setShowDatePicker(false)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.dateDoneText}>Fatto</Text>
        </Pressable>
      )}
      <TextInput style={styles.input} placeholder="Altezza (cm)" keyboardType="number-pad" value={heightCm} onChangeText={setHeightCm} />
      {!!heightCm && !isHeightValid && <Text style={styles.error}>Inserisci un'altezza valida in centimetri (1-249).</Text>}
      <Text style={styles.label}>Piede preferito</Text>
      <View style={styles.row}>
        {FEET.map((foot) => (
          <Pressable key={foot} style={[styles.chip, preferredFoot === foot && styles.chipSelected]} onPress={() => setPreferredFoot(foot)}>
            <Text style={preferredFoot === foot ? styles.chipTextSelected : styles.chipText}>{FOOT_LABELS[foot]}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Ruolo</Text>
      <View style={styles.row}>
        {ROLES.map((role) => (
          <Pressable key={role} style={[styles.chip, playerRole === role && styles.chipSelected]} onPress={() => setPlayerRole(role)}>
            <Text style={playerRole === role ? styles.chipTextSelected : styles.chipText}>{ROLE_LABELS[role]}</Text>
          </Pressable>
        ))}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={withPressed(styles.button)}
        disabled={loading || !canSubmit}
        onPress={() => onSubmit({ firstName, lastName, birthDate, heightCm, preferredFoot, playerRole })}
      >
        {loading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>{submitLabel}</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, padding: spacing.spaceLg, gap: spacing.spaceSm },
  avatarWrapper: { alignItems: 'center', marginBottom: spacing.spaceSm },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarPlaceholder: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarPlaceholderText: { color: colors.onPrimary, fontFamily: 'Sora_700Bold', fontSize: 36 },
  avatarHint: { color: colors.primary, ...typography.meta, marginTop: spacing.spaceXs, fontFamily: 'WorkSans_600SemiBold' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, ...typography.body },
  dateValue: { ...typography.body, color: colors.ink },
  datePlaceholder: { ...typography.body, color: colors.muted },
  iosDatePicker: { alignSelf: 'center' },
  dateDoneButton: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: spacing.spaceXs, marginTop: -8 },
  dateDoneText: { color: colors.primary, fontFamily: 'WorkSans_600SemiBold', fontSize: 15 },
  label: { fontFamily: 'WorkSans_600SemiBold', fontSize: 15, marginTop: spacing.spaceXs },
  row: { flexDirection: 'row', gap: spacing.spaceXs },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusPill, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceMd },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.ink, ...typography.body },
  chipTextSelected: { color: colors.onPrimary, ...typography.body },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceMd },
  buttonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  error: { color: colors.danger },
});
