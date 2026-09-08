import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { colors, typography, spacing, withPressed } from '@/theme';

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

  function handleMatchTypeChange(type: 5 | 7 | 8) {
    setMatchType(type);
    // Only auto-fill the suggested default when this is a fresh creation (no
    // initialValues) AND the user hasn't already typed a custom max-players
    // value away from the current type's own default.
    if (!initialValues && maxPlayers === String(DEFAULT_MAX_PLAYERS[matchType])) {
      setMaxPlayers(String(DEFAULT_MAX_PLAYERS[type]));
    }
  }

  const canSubmit = !!(fieldName && address && matchDate && startTime && endTime && maxPlayers);

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
      <TextInput
        style={styles.input}
        placeholder="Data (AAAA-MM-GG)"
        value={matchDate}
        onChangeText={setMatchDate}
      />
      <TextInput
        style={styles.input}
        placeholder="Ora inizio (HH:MM)"
        value={startTime}
        onChangeText={setStartTime}
      />
      <TextInput style={styles.input} placeholder="Ora fine (HH:MM)" value={endTime} onChangeText={setEndTime} />
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
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{submitLabel}</Text>}
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
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceMd },
  buttonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  error: { color: colors.danger },
});
