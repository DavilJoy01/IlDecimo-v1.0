import { useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView, Platform } from 'react-native';
import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
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
  externalConfirmedCount: string;
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
  const [externalConfirmedCount, setExternalConfirmedCount] = useState(initialValues?.externalConfirmedCount ?? '0');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [activePicker, setActivePicker] = useState<ActivePicker>(null);
  // `parseTimeInput`'s fallback defaults to `new Date()` when the field is
  // still empty. Passing that straight into the picker's `value` prop would
  // recompute "now" on every render, and a native iOS spinner snaps back to
  // whatever `value` it's given -- fighting the user's own scroll gesture
  // mid-drag. Freezing "now" once, when the picker opens, keeps `value`
  // stable across re-renders while it's visible.
  const startTimeDefaultRef = useRef(new Date());
  const endTimeDefaultRef = useRef(new Date());

  function openStartPicker() {
    startTimeDefaultRef.current = new Date();
    setActivePicker('start');
  }

  function openEndPicker() {
    endTimeDefaultRef.current = new Date();
    setActivePicker('end');
  }

  function handleMatchTypeChange(type: 5 | 7 | 8) {
    setMatchType(type);
    // Only auto-fill the suggested default when this is a fresh creation (no
    // initialValues) AND the user hasn't already typed a custom max-players
    // value away from the current type's own default.
    if (!initialValues && maxPlayers === String(DEFAULT_MAX_PLAYERS[matchType])) {
      setMaxPlayers(String(DEFAULT_MAX_PLAYERS[type]));
    }
  }

  function handleDateChange(_event: DateTimePickerChangeEvent, selectedDate: Date) {
    if (Platform.OS === 'android') setActivePicker(null);
    setMatchDate(formatDateInput(selectedDate));
  }

  function handleStartTimeChange(_event: DateTimePickerChangeEvent, selectedDate: Date) {
    if (Platform.OS === 'android') setActivePicker(null);
    setStartTime(formatTimeInput(selectedDate));
  }

  function handleEndTimeChange(_event: DateTimePickerChangeEvent, selectedDate: Date) {
    if (Platform.OS === 'android') setActivePicker(null);
    setEndTime(formatTimeInput(selectedDate));
  }

  const isTimeRangeValid = !startTime || !endTime || endTime > startTime;
  const maxPlayersValue = Number(maxPlayers);
  const externalConfirmedValue = Number(externalConfirmedCount);
  const isExternalCountValid =
    externalConfirmedCount === '' ||
    (Number.isInteger(externalConfirmedValue) && externalConfirmedValue >= 0 && externalConfirmedValue < maxPlayersValue);
  const canSubmit =
    !!(fieldName && address && matchDate && startTime && endTime && maxPlayers) && isTimeRangeValid && isExternalCountValid;

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
      <TextInput style={styles.input} placeholder="Nome campo" placeholderTextColor={colors.muted} value={fieldName} onChangeText={setFieldName} />
      <TextInput style={styles.input} placeholder="Indirizzo" placeholderTextColor={colors.muted} value={address} onChangeText={setAddress} />
      <Pressable style={styles.input} onPress={() => setActivePicker('date')}>
        <Text style={matchDate ? styles.fieldValue : styles.fieldPlaceholder}>{matchDate || 'Data'}</Text>
      </Pressable>
      {Platform.OS === 'ios' && activePicker === 'date' && (
        <Pressable
          style={styles.pickerDoneButton}
          onPress={() => setActivePicker(null)}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        >
          <Text style={styles.pickerDoneText}>Fatto</Text>
        </Pressable>
      )}
      {activePicker === 'date' && (
        <DateTimePicker
          value={parseDateInput(matchDate)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          locale="it-IT"
          minimumDate={new Date()}
          onValueChange={handleDateChange}
          onDismiss={() => setActivePicker(null)}
          {...(Platform.OS === 'ios' ? { style: styles.iosPicker, themeVariant: 'dark' as const } : {})}
        />
      )}
      <Pressable style={styles.input} onPress={openStartPicker}>
        <Text style={startTime ? styles.fieldValue : styles.fieldPlaceholder}>{startTime || 'Ora inizio'}</Text>
      </Pressable>
      {Platform.OS === 'ios' && activePicker === 'start' && (
        <Pressable
          style={styles.pickerDoneButton}
          onPress={() => setActivePicker(null)}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        >
          <Text style={styles.pickerDoneText}>Fatto</Text>
        </Pressable>
      )}
      {activePicker === 'start' && (
        <DateTimePicker
          value={parseTimeInput(startTime, startTimeDefaultRef.current)}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          locale="it-IT"
          is24Hour
          onValueChange={handleStartTimeChange}
          onDismiss={() => setActivePicker(null)}
          {...(Platform.OS === 'ios' ? { style: styles.iosPicker, themeVariant: 'dark' as const } : {})}
        />
      )}
      <Pressable style={styles.input} onPress={openEndPicker}>
        <Text style={endTime ? styles.fieldValue : styles.fieldPlaceholder}>{endTime || 'Ora fine'}</Text>
      </Pressable>
      {Platform.OS === 'ios' && activePicker === 'end' && (
        <Pressable
          style={styles.pickerDoneButton}
          onPress={() => setActivePicker(null)}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        >
          <Text style={styles.pickerDoneText}>Fatto</Text>
        </Pressable>
      )}
      {activePicker === 'end' && (
        <DateTimePicker
          value={parseTimeInput(endTime, endTimeDefaultRef.current)}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          locale="it-IT"
          is24Hour
          onValueChange={handleEndTimeChange}
          onDismiss={() => setActivePicker(null)}
          {...(Platform.OS === 'ios' ? { style: styles.iosPicker, themeVariant: 'dark' as const } : {})}
        />
      )}
      {!isTimeRangeValid && (
        <Text style={styles.error}>L&apos;ora di fine deve essere successiva all&apos;ora di inizio.</Text>
      )}
      <TextInput
        style={styles.input}
        placeholder="Numero massimo giocatori"
        placeholderTextColor={colors.muted}
        keyboardType="number-pad"
        value={maxPlayers}
        onChangeText={setMaxPlayers}
      />
      <TextInput
        style={styles.input}
        placeholder="Giocatori già confermati fuori dall'app"
        placeholderTextColor={colors.muted}
        keyboardType="number-pad"
        value={externalConfirmedCount}
        onChangeText={setExternalConfirmedCount}
      />
      <Text style={styles.hint}>
        Hai già una squadra? Conta qui chi ha già confermato fuori dall&apos;app: cercheremo solo i posti che mancano.
      </Text>
      {!isExternalCountValid && (
        <Text style={styles.error}>Deve essere un numero minore del massimo giocatori.</Text>
      )}
      <TextInput
        style={[styles.input, styles.multiline]}
        placeholder="Descrizione (opzionale)"
        placeholderTextColor={colors.muted}
        value={description}
        onChangeText={setDescription}
        multiline
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={withPressed(styles.button)}
        disabled={loading || !canSubmit}
        onPress={() =>
          onSubmit({
            matchType,
            fieldName,
            address,
            matchDate,
            startTime,
            endTime,
            maxPlayers,
            externalConfirmedCount,
            description,
          })
        }
      >
        {loading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>{submitLabel}</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, padding: spacing.spaceLg, gap: spacing.spaceSm },
  label: { fontFamily: 'Archivo_600SemiBold', fontSize: 15, color: colors.ink, marginTop: spacing.spaceXs },
  row: { flexDirection: 'row', gap: spacing.spaceXs },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusPill, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceMd },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.ink, ...typography.body },
  chipTextSelected: { color: colors.onPrimary, ...typography.body },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, color: colors.ink, ...typography.body },
  fieldValue: { ...typography.body, color: colors.ink },
  fieldPlaceholder: { ...typography.body, color: colors.muted },
  iosPicker: { alignSelf: 'center' },
  pickerDoneButton: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: spacing.spaceXs },
  pickerDoneText: { color: colors.primary, fontFamily: 'Archivo_600SemiBold', fontSize: 15 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  hint: { ...typography.meta, color: colors.muted, marginTop: -2 },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceMd },
  buttonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  error: { color: colors.danger },
});
