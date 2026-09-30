const TYPES = ['全部', '公园滑梯', '社区滑梯', '室内乐园', '其他'];
const AGES = ['全年龄', '1–3岁', '3–6岁', '6岁以上'];
const COSTS = ['免费', '收费'];
const AMENITIES = ['有遮阴', '座椅多', '座椅少', '有卫生间', '软质地面', '可骑车'];
const PARKING = ['停车免费', '停车收费', '不方便停车'];
class ValidationError extends Error {}
function text(value, name, min, max) {
  if (typeof value !== 'string') throw new ValidationError(`请填写${name}`);
  const result = value.trim();
  if (result.length < min || result.length > max) throw new ValidationError(`${name}需为 ${min}–${max} 个字`);
  return result;
}
function choice(value, choices, name) {
  if (!choices.includes(value)) throw new ValidationError(`请选择有效的${name}`);
  return value;
}
function coordinates(latitude, longitude) {
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new ValidationError('请在地图上选择有效位置');
  }
  return { latitude, longitude };
}
function slideInput(input) {
  const amenities = input.amenities || [];
  if (
    !Array.isArray(amenities) ||
    amenities.length > AMENITIES.length ||
    amenities.some((a) => !AMENITIES.concat(['有座椅', '有停车位']).includes(a))
  )
    throw new ValidationError('配套设施选项无效');
  if (amenities.includes('座椅多') && amenities.includes('座椅少'))
    throw new ValidationError('座椅多和座椅少只能选择一项');
  const photos = input.photos || [];
  if (
    !Array.isArray(photos) ||
    photos.length > 6 ||
    photos.some((id) => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))
  )
    throw new ValidationError('最多上传6张有效照片');
  const parkingLocation =
    input.parkingLocation == null
      ? null
      : coordinates(input.parkingLocation.latitude, input.parkingLocation.longitude);
  return {
    title: text(input.title, '滑梯名称', 2, 40),
    address: text(input.address, '地址', 2, 160),
    description: text(input.description, '玩法介绍', 5, 1000),
    ...coordinates(input.latitude, input.longitude),
    type: choice(input.type, TYPES.slice(1), '场地类型'),
    ageBand: choice(input.ageBand, AGES, '适合年龄'),
    cost: choice(input.cost, COSTS, '收费情况'),
    amenities: [...new Set(amenities)],
    openingHours: text(input.openingHours || '以现场公示为准', '开放时间', 1, 80),
    photos: [...new Set(photos)],
    parking: choice(input.parking || '', ['', ...PARKING], '停车情况'),
    parkingAddress: text(input.parkingAddress || '', '停车场地址', 0, 160),
    parkingLocation,
    traffic: text(input.traffic || '', '交通信息', 0, 500),
  };
}
function reviewInput(input) {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
    throw new ValidationError('请选择 1–5 星评分');
  return { rating: input.rating, content: text(input.content, '评价', 5, 500) };
}
function distanceKm(aLat, aLng, bLat, bLng) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((bLat - aLat) * rad) / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(((bLng - aLng) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function distanceLabel(km) {
  return km == null ? '' : km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}
function presentSlide(slide) {
  return {
    ...slide,
    ratingLabel: slide.reviewCount ? Number(slide.rating).toFixed(1) : '暂无',
    distanceLabel: distanceLabel(slide.distance),
    dateLabel: new Date(slide.createdAt).toLocaleDateString('zh-CN'),
  };
}
module.exports = {
  TYPES,
  AGES,
  COSTS,
  AMENITIES,
  PARKING,
  ValidationError,
  text,
  coordinates,
  slideInput,
  reviewInput,
  distanceKm,
  distanceLabel,
  presentSlide,
};
