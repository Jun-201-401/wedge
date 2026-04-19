package com.wedge.auth.infrastructure;

import com.wedge.auth.domain.UserAccount;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.Optional;
import java.util.UUID;

@Mapper
public interface UserAccountMapper {
    Optional<UserAccount> findById(@Param("id") UUID id);
    Optional<UserAccount> findByAuthSubject(@Param("authSubject") String authSubject);
    int insert(UserAccount userAccount);
}
