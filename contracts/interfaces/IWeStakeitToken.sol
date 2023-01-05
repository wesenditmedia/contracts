// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IWeStakeitToken is IERC721 {
    /**
     * Mint a NFT as staking entry
     *
     * @param receiver address - Receiver address
     *
     * @return tokenId uint256 - Minted token id
     */
    function mint(address receiver) external returns (uint256 tokenId);
}
