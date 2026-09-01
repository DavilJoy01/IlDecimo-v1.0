import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';

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
        style={styles.button}
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
  container: { padding: 24, gap: 12 },
  label: { fontWeight: '600', marginTop: 8 },
  row: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 },
  chipSelected: { backgroundColor: '#1a7f37', borderColor: '#1a7f37' },
  chipText: { color: '#333' },
  chipTextSelected: { color: '#fff' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  button: { backgroundColor: '#1a7f37', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#c0392b' },
});
