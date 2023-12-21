// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./IStakingPool.sol";

struct PoolEntryWithRewards {
    PoolEntry poolEntry;
    uint256 tokenId;
    uint256 pendingRewards;
}

interface IStakingUtils {
    /**
     * Returns the staking pool address
     */
    function stakingPool() external view returns (address value);

    /**
     * Returns staking pool APY values for each week
     */
    function apys() external view returns (uint256[] memory value);

    /**
     * Returns staking pool APR values for each week
     */
    function aprs() external view returns (uint256[] memory value);

    /**
     * Returns all staking token ids for a specific address
     *
     * @param addr address - address to get token ids for
     */
    function stakingTokenIds(
        address addr
    ) external view returns (uint256[] memory value);

    /**
     * Returns all staking entries for a specific address, including pending rewards
     *
     * @param addr address - address to get staking entries for
     */
    function stakingEntries(
        address addr
    ) external view returns (PoolEntryWithRewards[] memory value);

    /**
     * Returns a single staking entry for a specific token id
     *
     * @param tokenId uint256 - token id to fetch entry for
     */
    function stakingEntry(
        uint256 tokenId
    ) external view returns (PoolEntryWithRewards memory value);

    /**
     * Returns a bulk of staking entries for start -> start + amount
     *
     * @param start uint256 - token id to start at
     * @param amount uint256 - amount of entries to fetch (exclusive)
     */
    function stakingEntriesBulk(
        uint256 start,
        uint256 amount
    ) external view returns (PoolEntryWithRewards[] memory value);
}
