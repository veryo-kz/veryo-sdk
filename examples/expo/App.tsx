import { getSignals } from '@veryo/react-native'
import { useState } from 'react'
import { Button, SafeAreaView, StyleSheet, Text, TextInput } from 'react-native'

// Your backend (examples/bun-server). On a device use the machine's LAN address.
const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'

async function post(path: string, body: unknown) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.reason ?? json.error ?? `HTTP ${res.status}`)
  return json
}

export default function App() {
  const [phone, setPhone] = useState('+77')
  const [code, setCode] = useState('')
  const [id, setId] = useState<string>()
  const [message, setMessage] = useState('')

  const start = async () => {
    try {
      const { id } = await post('/start', { phone, signals: await getSignals() })
      setId(id)
      setMessage('')
    } catch (e) {
      setMessage(String((e as Error).message))
    }
  }

  const check = async () => {
    try {
      const { status } = await post('/check', { id, code })
      setMessage(status === 'verified' ? 'Готово, вы вошли' : `Статус: ${status}`)
    } catch (e) {
      setMessage(String((e as Error).message))
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      {id ? (
        <>
          <Text>Код отправлен на {phone}</Text>
          <TextInput style={styles.input} value={code} onChangeText={setCode} keyboardType="number-pad"
            autoComplete="one-time-code" textContentType="oneTimeCode" placeholder="Код" />
          <Button title="Проверить" onPress={check} />
          <Button title="Другой номер" onPress={() => { setId(undefined); setCode('') }} />
        </>
      ) : (
        <>
          <Text>Номер телефона</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad"
            autoComplete="tel" placeholder="+77XXXXXXXXX" />
          <Button title="Получить код" onPress={start} />
        </>
      )}
      {message ? <Text>{message}</Text> : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  input: { borderWidth: 1, borderColor: '#999', borderRadius: 8, padding: 12, fontSize: 18 },
})
