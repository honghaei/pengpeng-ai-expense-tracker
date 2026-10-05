import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function LaunchScreen({ onContinue }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.985)).current;
  const promptOpacity = useRef(new Animated.Value(0)).current;
  const promptLift = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 450,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 8,
        tension: 55,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.sequence([
      Animated.delay(550),
      Animated.parallel([
        Animated.timing(promptOpacity, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }),
        Animated.timing(promptLift, {
          toValue: 0,
          duration: 350,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [opacity, scale, promptLift, promptOpacity]);

  return (
    <Pressable
      style={styles.container}
      onPress={onContinue}
      accessibilityRole="button"
      accessibilityLabel="Continue to Pengpeng"
    >
      <StatusBar barStyle="light-content" backgroundColor="#03142F" />

      <Animated.View
        style={[
          styles.artWrap,
          {
            opacity,
            transform: [{ scale }],
          },
        ]}
      >
        <Image
          source={require('../../assets/branding/pengpeng-splash.png')}
          style={styles.art}
          resizeMode="cover"
        />
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.continueWrap,
          {
            opacity: promptOpacity,
            transform: [{ translateY: promptLift }],
          },
        ]}
      >
        <View style={styles.continuePill}>
          <Text style={styles.continueText}>Tap to continue</Text>
          <Ionicons name="arrow-forward" size={16} color="#DDF8FF" />
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#03142F',
  },

  artWrap: {
    ...StyleSheet.absoluteFillObject,
  },

  art: {
    width: '100%',
    height: '100%',
  },

  continueWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 44,
    alignItems: 'center',
  },

  continuePill: {
    minHeight: 42,
    paddingHorizontal: 18,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(3, 20, 47, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(126, 218, 255, 0.28)',
  },

  continueText: {
    color: '#EAF8FF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
