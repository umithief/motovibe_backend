import { serviceResult,throwError } from '../../utils/serviceResult.js';


import User from "./model.js";

import AppError from "../../utils/appError.js";
import { hasActiveApexAccess } from "../../utils/apexAccess.js";
import { PROFILE_THEMES, PROFILE_THEME_CATALOG_VERSION, findProfileTheme,
  addProfileThemeResponse, profileThemeEntitlementQuery } from "../../utils/profileThemes.js";

// Dependency injection supports real HTTP/authorization tests without production MongoDB.
export function createProfileThemeServices({ UserModel = User, clock = () => new Date() } = {}) {
  const preference = user => ({ userId:user._id.toString(),
    profileThemeId:user.profileThemeId,profileThemeConfigVersion:user.profileThemeConfigVersion,
    profileThemeUpdatedAt:user.profileThemeUpdatedAt,
    effectiveProfileThemeId:user.effectiveProfileThemeId,
    isPro:hasActiveApexAccess(user,clock()),proExpiryDate:user.proExpiryDate || null,
  });
  const write = async (input,theme) => {
    if (!input.user?.id) return throwError(new AppError('Giriş yapmanız gerekiyor.',401));
    const now = clock();
    const filter = { _id:input.user.id,isDeleted:{$ne:true},
      ...(theme.requiresPro ? profileThemeEntitlementQuery(now) : {}),
    };
    // Owner and entitlement are checked atomically with the write. Body-supplied
    // isPro/isApex/userId are never consulted and cannot target another account.
    const user = await UserModel.findOneAndUpdate(filter,{$set:{
      profileThemeId:theme.id,profileThemeConfigVersion:theme.version,profileThemeUpdatedAt:now,
    }},{new:true,runValidators:true}).select('_id profileThemeId profileThemeConfigVersion profileThemeUpdatedAt isPro isPremium isAdmin proExpiryDate');
    if(!user) return throwError(new AppError(theme.requiresPro ? 'Bu tema için aktif PRO üyeliği gerekli.' : 'Kullanıcı bulunamadı.',theme.requiresPro ? 403 : 404));
    const snapshot = user.toObject ? user.toObject() : {...user};
    addProfileThemeResponse(snapshot,clock());
    return serviceResult({status:'success',data:preference(snapshot)},200);
  };
  return {
    catalog:async (input) => serviceResult({status:'success',data:{
      catalogVersion:PROFILE_THEME_CATALOG_VERSION,themes:PROFILE_THEMES,
    }},200),
    detail:async (input) => {
      const theme=findProfileTheme(input.params.themeId);
      if(!theme || theme.isDeprecated) return throwError(new AppError('Tema bulunamadı.',404));
      return serviceResult({status:'success',data:{catalogVersion:PROFILE_THEME_CATALOG_VERSION,theme}},200);
    },
    update:async (input) => {
      if(!input.body || typeof input.body !== 'object' || Array.isArray(input.body) ||
        Object.keys(input.body).some(key => !['themeId','configVersion'].includes(key))) {
        return throwError(new AppError('Geçersiz tema tercihi.',400));
      }
      if(typeof input.body.themeId !== 'string' || input.body.themeId.length > 64) return throwError(new AppError('Geçersiz tema kimliği.',400));
      const theme=findProfileTheme(input.body.themeId);
      if(!theme || theme.isDeprecated) return throwError(new AppError('Tema bulunamadı.',404));
      if(input.body.configVersion !== theme.version) return throwError(new AppError('Tema sürümü desteklenmiyor. Kataloğu yenileyin.',409));
      return write(input,theme);
    },
    reset:async (input) => write(input,findProfileTheme('default')),
  };
}
