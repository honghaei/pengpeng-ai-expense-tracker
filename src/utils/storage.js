import AsyncStorage from '@react-native-async-storage/async-storage';

const debug = (...args) => {
  if (__DEV__) console.debug(...args);
};

export const checkFirstLaunch = async () => {
  try {
    const value = await AsyncStorage.getItem('alreadyLaunched');
    if (value === null) {
      await AsyncStorage.setItem('alreadyLaunched', 'true');
      return true;
    }
    return false;
  } catch (error) {
    if (__DEV__) console.warn('Unable to check first launch.', error);
    return false;
  }
};

export const saveData = async (key, value) => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    debug(`[storage] saved ${key}`);
    return true;
  } catch (error) {
    if (__DEV__) console.warn(`[storage] failed to save ${key}`, error);
    return false;
  }
};

export const getData = async (key) => {
  try {
    const value = await AsyncStorage.getItem(key);
    if (value == null) return [];
    return JSON.parse(value);
  } catch (error) {
    if (__DEV__) console.warn(`[storage] failed to load ${key}`, error);
    return [];
  }
};

export const removeData = async (key) => {
  try {
    await AsyncStorage.removeItem(key);
    return true;
  } catch (error) {
    if (__DEV__) console.warn(`[storage] failed to remove ${key}`, error);
    return false;
  }
};
