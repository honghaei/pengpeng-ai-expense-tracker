import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

export default function PengpengAvatar({ size = 44, ring = true }) {
  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: ring ? 1 : 0,
        },
      ]}
    >
      <Image
        source={require('../../assets/branding/pengpeng-avatar.png')}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
        }}
        resizeMode="cover"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#071A38',
    borderColor: 'rgba(79, 217, 255, 0.52)',
    shadowColor: '#4FD9FF',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
});
