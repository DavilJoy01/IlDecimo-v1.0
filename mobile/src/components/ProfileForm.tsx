import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { FOOT_LABELS, ROLE_LABELS } from '@/utils/profileDisplay';

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

  const canSubmit = !!(firstName && lastName && birthDate && heightCm);

  async function handlePickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      setPreviewUri(result.assets[0].uri);
      onImageSelected?.(result.assets[0].uri);
    }
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
      <TextInput style={styles.input} placeholder="Data di nascita (AAAA-MM-GG)" value={birthDate} onChangeText={setBirthDate} />
      <TextInput style={styles.input} placeholder="Altezza (cm)" keyboardType="number-pad" value={heightCm} onChangeText={setHeightCm} />
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
        style={styles.button}
        disabled={loading || !canSubmit}
        onPress={() => onSubmit({ firstName, lastName, birthDate, heightCm, preferredFoot, playerRole })}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{submitLabel}</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  avatarWrapper: { alignItems: 'center', marginBottom: 12 },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarPlaceholder: { backgroundColor: '#1a7f37', alignItems: 'center', justifyContent: 'center' },
  avatarPlaceholderText: { color: '#fff', fontSize: 36, fontWeight: '700' },
  avatarHint: { color: '#1a7f37', fontSize: 13, marginTop: 8, fontWeight: '600' },
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
