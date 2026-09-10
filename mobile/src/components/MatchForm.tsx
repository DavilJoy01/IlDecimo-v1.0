import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView, Platform } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { formatDateInput, parseDateInput, formatTimeInput, parseTimeInput } from '@/utils/dateTimeInput';
import { colors, typography, spacing, withPressed } from '@/theme';

type ActivePicker = 'date' | 'start' | 'end' | null;

const MATCH_TYPES = [5, 7, 8] as const;
const DEFAULT_MAX_PLAYERS: Record<(typeof MATCH_TYPES)[number], number> = { 5: 10, 7: 14, 8: 16 };

export interface MatchFormValues {
  matchType: 5 | 7 | 8;
  fieldName: string;
  address: string;
  matchDate: string;
  startTime: string;
  endTime: string;
  maxPlayers: string;
  description: string;
}

interface MatchFormProps {
  initialValues?: MatchFormValues;
  onSubmit: (values: MatchFormValues) => void;
  submitLabel: string;
  loading?: boolean;
  error?: string | null;
}

export function MatchForm({ initialValues, onSubmit, submitLabel, loading, error }: MatchFormProps) {
  const [matchType, setMatchType] = useState<5 | 7 | 8>(initialValues?.matchType ?? 5);
  const [fieldName, setFieldName] = useState(initialValues?.fieldName ?? '');
  const [address, setAddress] = useState(initialValues?.address ?? '');
  const [matchDate, setMatchDate] = useState(initialValues?.matchDate ?? '');
  const [startTime, setStartTime] = useState(initialValues?.startTime ?? '');
  const [endTime, setEndTime] = useState(initialValues?.endTime ?? '');
  const [maxPlayers, setMaxPlayers] = useState(initialValues?.maxPlayers ?? String(DEFAULT_MAX_PLAYERS[5]));
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [activePicker, setActivePicker] = useState<ActivePicker>(null);

  function handleMatchTypeChange(type: 5 | 7 | 8) {
    setMatchType(type);
    // Only auto-fill the suggested default when this is a fresh creation (no
    // initialValues) AND the user hasn't already typed a custom max-players
    // value away from the current type's own default.
    if (!initialValues && maxPlayers === String(DEFAULT_MAX_PLAYERS[matchType])) {
      setMaxPlayers(String(DEFAULT_MAX_PLAYERS[type]));
    }
  }

  function handleDateChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (Platform.OS === 'android') setActivePicker(null);
    if (event.type === 'set' && selectedDate) setMatchDate(formatDateInput(selectedDate));
  }

  function handleStartTimeChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (Platform.OS === 'android') setActivePicker(null);
    if (event.type === 'set' && selectedDate) setStartTime(formatTimeInput(selectedDate));
  }

  function handleEndTimeChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (Platform.OS === 'android') setActivePicker(null);
    if (event.type === 'set' && selectedDate) setEndTime(formatTimeInput(selectedDate));
  }

  const isTimeRangeValid = !startTime || !endTime || endTime > startTime;
  const canSubmit = !!(fieldName && address && matchDate && startTime && endTime && maxPlayers) && isTimeRangeValid;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Tipo partita</Text>
      <View style={styles.row}>
        {MATCH_TYPES.map((type) => (
          <Pressable
            key={type}
            style={[styles.chip, matchType === type && styles.chipSelected]}
            onPress={() => handleMatchTypeChange(type)}
          >
            <Text style={matchType === type ? styles.chipTextSelected : styles.chipText}>{type}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput style={styles.input} placeholder="Nome campo" value={fieldName} onChangeText={setFieldName} />
      <TextInput style={styles.input} placeholder="Indirizzo" value={address} onChangeText={setAddress} />
      <Pressable style={styles.input} onPress={() => setActivePicker('date')}>
        <Text style={matchDate ? styles.fieldValue : styles.fieldPlaceholder}>{matchDate || 'Data'}</Text>
      </Pressable>
      {activePicker === 'date' && (
        <DateTimePicker
          value={parseDateInput(matchDate)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          locale="it-IT"
          minimumDate={new Date()}
          onChange={handleDateChange}
          {...(Platform.OS === 'ios' ? { style: styles.iosPicker } : {})}
        />
      )}
      {Platform.OS === 'ios' && activePicker === 'date' && (
        <Pressable
          style={styles.pickerDoneButton}
          onPress={() => setActivePicker(null)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.pickerDoneText}>Fatto</Text>
        </Pressable>
      )}
      <Pressable style={styles.input} onPress={() => setActivePicker('start')}>
        <Text style={startTime ? styles.fieldValue : styles.fieldPlaceholder}>{startTime || 'Ora inizio'}</Text>
      </Pressable>
      {activePicker === 'start' && (
        <DateTimePicker
          value={parseTimeInput(startTime)}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          locale="it-IT"
          is24Hour
          onChange={handleStartTimeChange}
          {...(Platform.OS === 'ios' ? { style: styles.iosPicker } : {})}
        />
      )}
      {Platform.OS === 'ios' && activePicker === 'start' && (
        <Pressable
          style={styles.pickerDoneButton}
          onPress={() => setActivePicker(null)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.pickerDoneText}>Fatto</Text>
        </Pressable>
      )}
      <Pressable style={styles.input} onPress={() => setActivePicker('end')}>
        <Text style={endTime ? styles.fieldValue : styles.fieldPlaceholder}>{endTime || 'Ora fine'}</Text>
      </Pressable>
      {activePicker === 'end' && (
        <DateTimePicker
          value={parseTimeInput(endTime)}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          locale="it-IT"
          is24Hour
          onChange={handleEndTimeChange}
          {...(Platform.OS === 'ios' ? { style: styles.iosPicker } : {})}
        />
      )}
      {Platform.OS === 'ios' && activePicker === 'end' && (
        <Pressable
          style={styles.pickerDoneButton}
          onPress={() => setActivePicker(null)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.pickerDoneText}>Fatto</Text>
        </Pressable>
      )}
      {!isTimeRangeValid && (
        <Text style={styles.error}>L&apos;ora di fine deve essere successiva all&apos;ora di inizio.</Text>
      )}
      <TextInput
        style={styles.input}
        placeholder="Numero massimo giocatori"
        keyboardType="number-pad"
        value={maxPlayers}
        onChangeText={setMaxPlayers}
      />
      <TextInput
        style={[styles.input, styles.multiline]}
        placeholder="Descrizione (opzionale)"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={withPressed(styles.button)}
        disabled={loading || !canSubmit}
        onPress={() =>
          onSubmit({ matchType, fieldName, address, matchDate, startTime, endTime, maxPlayers, description })
        }
      >
        {loading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>{submitLabel}</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, padding: spacing.spaceLg, gap: spacing.spaceSm },
  label: { fontFamily: 'WorkSans_600SemiBold', fontSize: 15, marginTop: spacing.spaceXs },
  row: { flexDirection: 'row', gap: spacing.spaceXs },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusPill, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceMd },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.ink, ...typography.body },
  chipTextSelected: { color: colors.onPrimary, ...typography.body },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, ...typography.body },
  fieldValue: { ...typography.body, color: colors.ink },
  fieldPlaceholder: { ...typography.body, color: colors.muted },
  iosPicker: { alignSelf: 'center' },
  pickerDoneButton: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: spacing.spaceXs, marginTop: -8 },
  pickerDoneText: { color: colors.primary, fontFamily: 'WorkSans_600SemiBold', fontSize: 15 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceMd },
  buttonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  error: { color: colors.danger },
});
