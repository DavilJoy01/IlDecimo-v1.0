import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useRegistration } from '@/hooks/useRegistration';
import { useSessionStore } from '@/stores/sessionStore';

const FEET = ['left', 'right', 'both'] as const;
const ROLES = ['player', 'goalkeeper', 'both'] as const;

export default function CreateProfileScreen() {
  const userId = useSessionStore((s) => s.session?.user.id);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [preferredFoot, setPreferredFoot] = useState<(typeof FEET)[number]>('right');
  const [playerRole, setPlayerRole] = useState<(typeof ROLES)[number]>('player');
  const { completeProfile, loading, error } = useRegistration();

  const canSubmit = !!userId && firstName && lastName && birthDate && heightCm;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Crea il tuo profilo</Text>
      <TextInput style={styles.input} placeholder="Nome" value={firstName} onChangeText={setFirstName} />
      <TextInput style={styles.input} placeholder="Cognome" value={lastName} onChangeText={setLastName} />
      <TextInput style={styles.input} placeholder="Data di nascita (AAAA-MM-GG)" value={birthDate} onChangeText={setBirthDate} />
      <TextInput style={styles.input} placeholder="Altezza (cm)" keyboardType="number-pad" value={heightCm} onChangeText={setHeightCm} />
      <Text style={styles.label}>Piede preferito</Text>
      <View style={styles.row}>
        {FEET.map((foot) => (
          <Pressable key={foot} style={[styles.chip, preferredFoot === foot && styles.chipSelected]} onPress={() => setPreferredFoot(foot)}>
            <Text style={preferredFoot === foot ? styles.chipTextSelected : styles.chipText}>{foot}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Ruolo</Text>
      <View style={styles.row}>
        {ROLES.map((role) => (
          <Pressable key={role} style={[styles.chip, playerRole === role && styles.chipSelected]} onPress={() => setPlayerRole(role)}>
            <Text style={playerRole === role ? styles.chipTextSelected : styles.chipText}>{role}</Text>
          </Pressable>
        ))}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={styles.button}
        disabled={loading || !canSubmit}
        onPress={() =>
          userId &&
          completeProfile({
            userId,
            firstName,
            lastName,
            birthDate,
            heightCm: Number(heightCm),
            preferredFoot,
            playerRole,
          })
        }
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Crea profilo</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  label: { fontWeight: '600', marginTop: 8 },
  row: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 },
  chipSelected: { backgroundColor: '#1a7f37', borderColor: '#1a7f37' },
  chipText: { color: '#333' },
  chipTextSelected: { color: '#fff' },
  button: { backgroundColor: '#1a7f37', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#c0392b' },
});
