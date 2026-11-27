"""Match a project location against the supplied 50-year pressure station table."""

import re
import unicodedata
from collections import defaultdict
from functools import cache
from hashlib import sha256
from pathlib import Path

from wind_platform.services.assessment_extreme import valid_pressure

# The table lists stations rather than province-wide values. These station
# names are the explicit defaults for province-level lookups.
PROVINCE_DEFAULTS = {
    "北京": "北京市",
    "天津": "天津市",
    "上海": "上海市",
    "重庆": "重庆市",
    "河北": "石家庄市",
    "山西": "太原市",
    "内蒙古": "呼和浩特市",
    "辽宁": "沈阳市",
    "吉林": "长春市",
    "黑龙江": "哈尔滨市",
    "江苏": "南京市",
    "浙江": "杭州市",
    "安徽": "合肥市",
    "福建": "福州市",
    "江西": "南昌市",
    "山东": "济南市",
    "河南": "郑州市",
    "湖北": "武汉市",
    "湖南": "长沙市",
    "广东": "广州市",
    "广西": "南宁市",
    "海南": "海口市",
    "四川": "成都市",
    "贵州": "贵阳市",
    "云南": "昆明市",
    "西藏": "拉萨市",
    "陕西": "西安市",
    "甘肃": "兰州",
    "青海": "西宁",
    "宁夏": "银川",
    "新疆": "乌鲁木齐市",
    "台湾": "台北",
    "香港": "香港",
    "澳门": "澳门",
}
REGION_NAMES = {
    "内蒙古": "内蒙古自治区",
    "广西": "广西壮族自治区",
    "西藏": "西藏自治区",
    "宁夏": "宁夏回族自治区",
    "新疆": "新疆维吾尔自治区",
    "香港": "香港特别行政区",
    "澳门": "澳门特别行政区",
}
MUNICIPALITIES = {"北京", "天津", "上海", "重庆"}
SEPARATORS = r"[\s,、·/／;；>，]+"
CITY_SUFFIX = r"(?:自治州|地区|市|盟)"


def locality_key(name):
    return re.sub(
        r"(?:(?:满族|蒙古族|回族|土家族|苗族|藏族|壮族|彝族)*自治(?:县|旗)|"
        r"自治州|地区|新区|市|县|区|旗|盟)$",
        "",
        name,
    )


@cache
def pressure_index():
    path = Path(__file__).with_name("pressure_stations.txt")
    raw = path.read_bytes()
    digest = sha256(raw).hexdigest()
    index = defaultdict(list)
    for line in raw.decode("utf-8-sig").splitlines():
        if not line.strip():
            continue
        province, name, _, value = (part.strip() for part in line.split(","))
        pressure = float(value)
        if not valid_pressure(pressure):
            raise ValueError(f"Invalid built-in station pressure: {province}/{name}")
        index[locality_key(name)].append(
            {
                "province": province,
                "name": name,
                "pressure": pressure,
                "library": path.name,
                "sha256": digest,
            }
        )
    return index


def candidates(index, name, province):
    choices = [
        item
        for item in index.get(locality_key(name), ())
        if province is None or item["province"] == province
    ]
    exact = [item for item in choices if item["name"] == name]
    return exact or choices


def match_pressure(place):
    station, _ = pressure_lookup(place)
    return station


def pressure_lookup(place):
    place = unicodedata.normalize("NFKC", place).strip()
    if not place:
        return None, []
    index = pressure_index()
    parts = re.split(SEPARATORS, place, maxsplit=2)
    province = None
    for key in sorted(PROVINCE_DEFAULTS, key=len, reverse=True):
        formal = REGION_NAMES.get(key, key + ("市" if key in MUNICIPALITIES else "省"))
        # In particular, 吉林市 names the city. 吉林省 or a separated 吉林 names the province.
        prefix = next((alias for alias in (formal, key) if place.startswith(alias)), None)
        if prefix and not (
            prefix == key and place[len(key) :].startswith(("市", "州", "县", "区", "旗"))
        ):
            province = key
            place = re.sub("^" + SEPARATORS, "", place[len(prefix) :])
            parts = re.split(SEPARATORS, place, maxsplit=1) if place else []
            break
    if province is None and re.match(r"^[^ ,、·/，]{1,12}(?:省|自治区|特别行政区)", place):
        return None, []
    if len(parts) == 1:
        local = parts[0]
        exact_area = candidates(index, local, province)
        if len(exact_area) == 1:
            station = exact_area[0]
            is_city = re.search(CITY_SUFFIX + "$", local) or re.search(
                CITY_SUFFIX + "$", station["name"]
            )
            return {**station, "level": "city" if is_city else "county"}, []
        city_and_county = re.fullmatch(rf"(.+?{CITY_SUFFIX})(.+)", local)
        if city_and_county:
            parts = list(city_and_county.groups())

    city = parts[0] if len(parts) == 2 else None
    city_matches = candidates(index, city, province) if city else []
    if province is None and len(city_matches) == 1:
        province = city_matches[0]["province"]
    if parts:
        local = parts[-1]
        local_matches = candidates(index, local, province)
        if len(local_matches) == 1:
            return {**local_matches[0], "level": "county"}, []
        if len(city_matches) == 1:
            return {**city_matches[0], "level": "city"}, []
        provinces = sorted({station["province"] for station in local_matches})
        if len(provinces) > 1:
            return None, provinces
    if province:
        default = candidates(index, PROVINCE_DEFAULTS[province], province)
        if len(default) == 1:
            return {**default[0], "level": "province"}, []
    return None, []
