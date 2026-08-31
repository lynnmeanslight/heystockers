import AsyncStorage from '@react-native-async-storage/async-storage'

const GUIDE_KEY = 'heystockers:guide-seen'

export async function hasSeenGuide() {
  return (await AsyncStorage.getItem(GUIDE_KEY)) === '1'
}

export function markGuideSeen() {
  return AsyncStorage.setItem(GUIDE_KEY, '1')
}
