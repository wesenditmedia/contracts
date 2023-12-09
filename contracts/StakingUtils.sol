// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";

import "./interfaces/IStakingUtils.sol";
import "./interfaces/IStakingPool.sol";
import "./interfaces/IWeStakeitToken.sol";

contract StakingUtils is IStakingUtils {
    uint256 private constant STAKING_MAX_WEEKS = 52;
    IStakingPool private _stakingPool;

    constructor(address stakingPoolAddress) {
        _stakingPool = IStakingPool(stakingPoolAddress);
    }

    function stakingPool() external view override returns (address value) {
        return address(_stakingPool);
    }

    function apys() external view override returns (uint256[] memory value) {
        uint256[] memory values = new uint256[](STAKING_MAX_WEEKS);

        for (uint64 i = 1; i <= STAKING_MAX_WEEKS; i++) {
            values[i - 1] = _stakingPool.apy(i * 7);
        }

        return values;
    }

    function aprs() external view override returns (uint256[] memory value) {
        uint256[] memory values = new uint256[](STAKING_MAX_WEEKS);

        for (uint64 i = 1; i <= STAKING_MAX_WEEKS; i++) {
            values[i - 1] = _stakingPool.apr(i * 7);
        }

        return values;
    }

    function stakingEntries(
        address addr
    ) external view override returns (PoolEntryWithRewards[] memory value) {
        uint256[] memory tokenIds = stakingTokenIds(addr);
        PoolEntryWithRewards[] memory poolEntries = new PoolEntryWithRewards[](
            tokenIds.length
        );

        for (uint64 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];

            PoolEntryWithRewards memory poolEntry = PoolEntryWithRewards(
                _stakingPool.poolEntry(tokenId),
                tokenId,
                _stakingPool.pendingRewards(tokenId)
            );

            poolEntries[i] = poolEntry;
        }

        return poolEntries;
    }

    function stakingEntry(
        uint256 tokenId
    ) external view override returns (PoolEntryWithRewards memory value) {
        PoolEntryWithRewards memory poolEntry = PoolEntryWithRewards(
            _stakingPool.poolEntry(tokenId),
            tokenId,
            _stakingPool.pendingRewards(tokenId)
        );

        return poolEntry;
    }

    function stakingEntriesBulk(
        uint256 start,
        uint256 amount
    ) external view returns (PoolEntryWithRewards[] memory value) {
        IERC721Enumerable proofToken = IERC721Enumerable(
            address(_stakingPool.proofToken())
        );

        require(
            proofToken.totalSupply() >= start + amount,
            "StakingUtils: start + amount exceeds total supply"
        );

        PoolEntryWithRewards[] memory poolEntries = new PoolEntryWithRewards[](
            amount
        );

        uint256 arrIndex = 0;
        for (uint256 i = start; i < start + amount; i++) {
            PoolEntryWithRewards memory poolEntry = PoolEntryWithRewards(
                _stakingPool.poolEntry(i),
                i,
                _stakingPool.pendingRewards(i)
            );

            poolEntries[arrIndex] = poolEntry;
            arrIndex++;
        }

        return poolEntries;
    }

    function stakingTokenIds(
        address addr
    ) public view override returns (uint256[] memory value) {
        IERC721Enumerable proofToken = IERC721Enumerable(
            address(_stakingPool.proofToken())
        );

        uint256 balance = proofToken.balanceOf(addr);
        uint256[] memory tokenIds = new uint256[](balance);

        for (uint64 i = 0; i < balance; i++) {
            tokenIds[i] = proofToken.tokenOfOwnerByIndex(addr, i);
        }

        return tokenIds;
    }
}
